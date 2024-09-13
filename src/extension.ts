import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

type MergedKeywords =  { [key: string]: { description: string, file: string } }

// Variável global que contém os dados das keywords
let mergedKeywords: MergedKeywords = {};
let availableVersions: string[];

let outLog: vscode.OutputChannel;

function getExtensionConfig() {
    const config = vscode.workspace.getConfiguration('cmghelp');
    const rootPrefix = config.get<string>('rootPrefix');
    const version = config.get<string>('version');
    const solver = config.get<string>('solver');
    const keywordDataPath = config.get<string>('cmghelp.keywordDataPath');
    return { rootPrefix, version, solver, keywordDataPath };
}

/**
 * Carrega do arquivo CMGKeywords.json para popular tanto o mergedKeywords
 * quanto o availableVersion. O código tenta priorizar as keywords do solver
 * escolhido (GEM,IMEX,STARS) trazendo também as keywords dos outros solvers
 * para serem resolvidas caso o solver configurado  não tenha determinada keyword.
 * @param rootPrefix
 * @param version
 * @param preferredSolver
 * @returns {MergedKeywords,availableVersions}
 */
function loadKeywordData(rootPrefix: string, version: string, preferredSolver: string) {

    let { keywordDataPath } = getExtensionConfig();

    // Se o caminho não foi definido, usa o diretório home do usuário como padrão
    if (!keywordDataPath) {
        const homeDir = require('os').homedir();  // Diretório home do usuário
        keywordDataPath = path.join(homeDir, 'CMGKeywords.json');
    }

    if (!fs.existsSync(keywordDataPath)) {
        vscode.window.showErrorMessage(`O arquivo CMGKeywords.json não foi encontrado no caminho: ${keywordDataPath}`);
        outLog.appendLine(`Verifique se o caminho está correto: ${keywordDataPath}`);
        return null;
    }

    const rawData = fs.readFileSync(keywordDataPath, 'utf8');
    const keywordData = JSON.parse(rawData);
    const availableVersions = Object.keys(keywordData.versions);

    // Verifica se a versão existe
    if (!keywordData.versions[version]) {
        const msg = `A versão ${version} inexiste em CMGKeywords.json. Usando ${availableVersions[0]}.`;
        //vscode.window.showInformationMessage(msg);
        outLog.appendLine(`As versões disponíveis são: ${availableVersions.join(', ')}`);
        outLog.appendLine(msg);
        version=availableVersions[0];
    }
    const versionData = keywordData.versions[version];
    // Inicializa o objeto para armazenar as keywords mescladas
    let mergedKeywords: MergedKeywords = {};

    // Carregar o solver não preferido primeiro
    const solverOrder =
        preferredSolver === 'IMEX' ? ['STARS', 'GEM', 'IMEX'] :
        preferredSolver === 'GEM' ? ['STARS', 'IMEX', 'GEM'] :
        preferredSolver === 'STARS' ? ['IMEX', 'GEM', 'STARS'] : [];

    for (const order of solverOrder) {
        if (versionData[order]) {
            mergedKeywords = { ...versionData[order] };  // Carrega as keywords do solver não preferido
        }
    }

    // Carregar o solver preferido depois, sobrescrevendo quaisquer conflitos de keyword
    if (versionData[preferredSolver]) {
        mergedKeywords = { ...mergedKeywords, ...versionData[preferredSolver] };  // Sobrescreve com o solver preferido
    }

    return { mergedKeywords, availableVersions};  // Retorna as keywords mescladas
}

// Função para buscar a keyword com base nas configurações do usuário
function searchKeyword(keyword: string) {
    const solverData = mergedKeywords[keyword];

    if (!solverData) {
        //vscode.window.showErrorMessage(`A keyword ${keyword} não foi encontrada para o solver ${solver}.`);
        console.error(`A keyword ${keyword} não foi encontrada`);
        return null;
    }

    return solverData;
}

export function activate(context: vscode.ExtensionContext) {
    outLog = vscode.window.createOutputChannel('CMG Help Logs');
    outLog.appendLine('CMG Help extension has been activated');

    let cmgShowLogs = vscode.commands.registerCommand('cmghelp.showLogs', () => {
        outLog.show();  // Exibe o canal de saída no painel Output
        outLog.appendLine('Log information: Command executed');
    });
    context.subscriptions.push(cmgShowLogs);

    const { rootPrefix, version, solver } = getExtensionConfig();
    if (!rootPrefix || !version || !solver) {
        return new vscode.Hover('Configurações de rootPrefix, versão ou solver não estão definidas.');
    }
    const result = loadKeywordData(rootPrefix, version, solver);
    if (result) {
        mergedKeywords = result.mergedKeywords;
        availableVersions  = result.availableVersions;
    }
    else {
        return new vscode.Hover('O arquivo keywordData.json não foi carregado corretamente.');
    }

    // HoverProvider para exibir a descrição sintética ao passar o mouse sobre uma keyword
    const hoverProvider = vscode.languages.registerHoverProvider(
        { scheme: 'file', pattern: '**/*.{dat,inc}' }, {
        provideHover(document, position, token) {
            const isDisable = vscode.workspace.getConfiguration().get('cmghelp.disable', false);
            if (isDisable) {
                return null;
            }
            const range = document.getWordRangeAtPosition(position);
            const lineText = document.lineAt(position).text.trim();  // Captura a linha completa onde o cursor está

            // Verificar se a linha começa com a keyword no formato correto (pode ter espaços ou * antes)
            const keywordPattern = /^[\s\*]*([A-Z-]{2,}[A-Z0-9-]*)/;
            const match = lineText.match(keywordPattern);

            if (!match) {
              // Se a keyword não corresponder ao padrão ou não estiver na posição correta, não faça nada
              return;
            }

            const keyword = match[1].toUpperCase().trim();  // Extrai a keyword do match

            outLog.appendLine(`Keyword capturada no hover: ${keyword}`);

            const keywordInfo = searchKeyword(keyword);

            if (!keywordInfo) {
              return new vscode.Hover(`Nenhuma documentação encontrada para a keyword: ${keyword}`);
            }

            const hoverContent = new vscode.MarkdownString();
            hoverContent.appendMarkdown(`📖 **${keyword}**\n\n`);
            hoverContent.appendMarkdown(`${keywordInfo.description}\n\n`);
            outLog.appendLine(`Keyword passada para o comando cmghelp.openKeywordDocumentation: ${keyword}`);
            hoverContent.appendMarkdown(`🔗 [Mais informações](command:cmghelp.openKeywordDocumentation?${encodeURIComponent(JSON.stringify(keyword))})`);

            // Permitir que o link de "Mais informações" seja clicável
            hoverContent.isTrusted = true;

            return new vscode.Hover(hoverContent);
        }
    });

    context.subscriptions.push(hoverProvider);

    /**
     * Carrega o arquivo htm da documentação, para a keyword escolhida e
     * apresenta no webview. O htm é preprocessado para permitir funcionar
     * corretamente no webview.
     */
    vscode.commands.registerCommand('cmghelp.openKeywordDocumentation', (keyword: string) => {
        const { rootPrefix, version, solver } = getExtensionConfig();
        //outLog.appendLine('Config loaded:', rootPrefix, version, solver );
        outLog.appendLine(`** Vou buscar pela keyword: ${keyword}`);

        if (!rootPrefix || !version || !solver) {
            vscode.window.showErrorMessage('Configurações de rootPrefix, versão ou solver não estão definidas.');
            return;
        }

        if (!mergedKeywords) {
            outLog.appendLine(`Não há uma estrutura de dados de keywords carregada em memória`);
            return;
        }
        let htmlFilePath = '';
        let keywordInfo;
        let fileEnd='';

        if (keyword.indexOf(".htm") === -1) {

            keywordInfo = searchKeyword(keyword);

            if (!keywordInfo) {
                vscode.window.showErrorMessage(`Keyword ${keyword} não encontrada em memória`);
                return;
            }
            fileEnd = keywordInfo.file;
            htmlFilePath = path.join(rootPrefix, version, keywordInfo.file);
        }
        else {
            console.log('Veio este htm: ',keyword);
            fileEnd = keyword.split('#')[0];
            htmlFilePath = path.join(rootPrefix,version,fileEnd);
            keyword = path.basename(keyword).split('_')[0];
        }

        // Verifica se o arquivo existe
        if (!fs.existsSync(htmlFilePath)) {
            for (const version of availableVersions) {
                htmlFilePath = path.join(rootPrefix, version, fileEnd);
                if (fs.existsSync(htmlFilePath)) {
                    outLog.appendLine(`Encontrados os manuais em ${htmlFilePath}`);
                    break;
                }
                vscode.window.showErrorMessage(`A pasta de instalação do CMG (${htmlFilePath}) para os manuais não foi encontrada.`);
                return;
            }
        }

        const panel = vscode.window.createWebviewPanel(
            'keywordDocumentation',
            `${keyword} Doc`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.file(path.dirname(htmlFilePath)),
                    vscode.Uri.file(rootPrefix)
                ]
            }
        );

        // Lê o arquivo HTML e ajusta os caminhos das imagens
        fs.readFile(htmlFilePath, 'utf8', (err, data) => {
            outLog.appendLine(`Tentando abrir a keyword: ${keyword} no arquivo ${htmlFilePath}`);
            if (err) {
                vscode.window.showErrorMessage(`Erro ao carregar o arquivo HTML: ${err.message}`);
                return;
            }

            const adjustedHtmlContent = adjustHtmlReferences(data, htmlFilePath, fileEnd, panel);
            panel.webview.html = adjustedHtmlContent;
            panel.webview.onDidReceiveMessage(async (message:any) => {
                outLog.appendLine('Recebido este evento: ' + decodeURIComponent(message.command));
                outLog.appendLine('Recebido este evento: '+ decodeURIComponent(message.originalPath));
                const uri = path.join(decodeURIComponent(message.originalPath),decodeURIComponent(message.command).split('?')[1].replaceAll('"',''));
                vscode.commands.executeCommand('cmghelp.openKeywordDocumentation',uri);
            });
        });
    });

    /**
     * Comando para habilitar a extensão
     */
    vscode.commands.registerCommand('cmghelp.enable', () => {
        // Atualizar a configuração para definir cmghelp.disable como false
        vscode.workspace.getConfiguration().update('cmghelp.disable', false, vscode.ConfigurationTarget.Global)
            .then(() => {
                vscode.window.showInformationMessage('CMG Help has been enabled.');
                outLog.appendLine('CMG Help has been enabled.');
            }, err => {
                vscode.window.showErrorMessage(`Failed to enable CMG Help: ${err}`);
                outLog.appendLine(`Failed to enable CMG Help: ${err}`);
            });
    });

    /**
     * Comando para desabilitar a extensão
     */
    vscode.commands.registerCommand('cmghelp.disable', () => {
        // Atualizar a configuração para definir cmghelp.disable como true
        vscode.workspace.getConfiguration().update('cmghelp.disable', true, vscode.ConfigurationTarget.Global)
            .then(() => {
                vscode.window.showInformationMessage('CMG Help has been disabled.');
                outLog.appendLine('CMG Help has been disabled.');
            }, err => {
                vscode.window.showErrorMessage(`Failed to disable CMG Help: ${err}`);
                outLog.appendLine(`Failed to disable CMG Help: ${err}`);
            });
    });

    /**
     * Altera os links do htm carregado para funcionar com o esquema asWebView do VSCODE
     */
    function adjustHtmlReferences(htmlContent: string, htmlFilePath: string, fileEnd:string, panel: vscode.WebviewPanel): string {
        // Ajustar referências de CSS
        const isDarkTheme = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark;

        htmlContent = htmlContent.replace(/<link.*?href="(.*?)".*?>/g, (match, cssPath) => {
            const cssUri = panel.webview.asWebviewUri(vscode.Uri.file(path.join(path.dirname(htmlFilePath), cssPath)));
            return match.replace(cssPath, cssUri.toString());
        });

        // Ajustar referências de JS
        htmlContent = htmlContent.replace(/<script.*?src="(.*?)".*?>/g, (match, jsPath) => {
            const jsUri = panel.webview.asWebviewUri(vscode.Uri.file(path.join(path.dirname(htmlFilePath), jsPath)));
            return match.replace(jsPath, jsUri.toString());
        });

        // Ajustar referências de imagens (como SVG)
        htmlContent = htmlContent.replace(/<img.*?src="(.*?)".*?>/g, (match, imgPath) => {
            const imgUri = panel.webview.asWebviewUri(vscode.Uri.file(path.join(path.dirname(htmlFilePath), imgPath)));
            return match.replace(imgPath, imgUri.toString());
        });

        //Ajustar links internos para abrir no WebView
        htmlContent = htmlContent.replace(/<a.*?href="(.*?)".*?>/g, (match, linkPath) => {
            const keyword = path.basename(linkPath, path.extname(linkPath)).toUpperCase();
            return match.replace(linkPath, `command:cmghelp.openKeywordDocumentation?${encodeURIComponent(JSON.stringify(linkPath))}`);
        });

        // Adicionar script para capturar cliques em links
        const script = `
        <script>
            (function() {
                const vscode = window.acquireVsCodeApi(); // Chama apenas uma vez
                document.addEventListener('click', function(event) {
                    const target = event.target.closest('a');
                    if (target && target.href.startsWith('command:cmghelp.openKeywordDocumentation')) {
                        event.preventDefault();
                        const commandUri = target.href.split('command:')[1];
                        vscode.postMessage({ command: commandUri, originalPath: "${encodeURIComponent(path.dirname(fileEnd))}" }); // Envia mensagens usando a instância armazenada
                        //console.log('PostMessage enviado com ', commandUri)
                    }
                });
            })();

            (function() {
                const isDark = ${isDarkTheme};

                // Cria uma tag <style> e injeta os estilos
                const style = document.createElement('style');
                style.textContent = \`
                    body {
                        background-color: \${isDark ? '#1e1e1e' : '#ffffff'} !important;
                        color: \${isDark ? '#d4d4d4' : '#000000'} !important;
                    }
                    a {
                        color: \${isDark ? '#569cd6' : '#0066cc'} !important;
                    }
                    /* Outros estilos */
                \`;
                document.head.appendChild(style);
            })();
        </script>
        `;
        return htmlContent + script;
    }
}
