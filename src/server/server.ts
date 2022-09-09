import { Connection, FileChangeType } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
	TextDocuments,
	TextDocumentSyncKind,
} from "vscode-languageserver/node";
import type {
	InitializeParams,
	InitializeResult,
} from "vscode-languageserver/node";
import { URI } from "vscode-uri";
import type { FileSystemProvider } from "../shared/file-system";
import { doCompletion } from "./features/completion";
import { doDiagnostics } from "./features/diagnostics/diagnostics";
import { goDefinition } from "./features/go-definition/go-definition";
import { doHover } from "./features/hover/hover";
import { provideReferences } from "./features/references";
import { doSignatureHelp } from "./features/signature-help/signature-help";
import { searchWorkspaceSymbol } from "./features/workspace-symbols/workspace-symbol";
import { getFileSystemProvider } from "./file-system-provider";
import { RuntimeEnvironment } from "./runtime";
import ScannerService from "./scanner";
import type { ISettings } from "./settings";
import StorageService from "./storage";
import { getSCSSRegionsDocument } from "./utils/embedded";

interface InitializationOption {
	workspace: string;
	settings: ISettings;
}

export class SomeSassServer {
	private readonly connection: Connection;
	private readonly runtime: RuntimeEnvironment;

	constructor(connection: Connection, runtime: RuntimeEnvironment) {
		this.connection = connection;
		this.runtime = runtime;
	}

	public listen(): void {
		let workspaceRoot: URI;
		let settings: ISettings;
		let storageService: StorageService;
		let scannerService: ScannerService;
		let fileSystemProvider: FileSystemProvider;

		// Create a simple text document manager. The text document manager
		// _supports full document sync only
		const documents = new TextDocuments(TextDocument);

		// Make the text document manager listen on the connection
		// _for open, change and close text document events
		documents.listen(this.connection);

		// After the server has started the client sends an initilize request. The server receives
		// _in the passed params the rootPath of the workspace plus the client capabilites
		this.connection.onInitialize(
			async (params: InitializeParams): Promise<InitializeResult> => {
				const options = params.initializationOptions as InitializationOption;

				fileSystemProvider = getFileSystemProvider(
					this.connection,
					this.runtime,
				);

				workspaceRoot = URI.parse(options.workspace);
				settings = options.settings;

				return {
					capabilities: {
						textDocumentSync: TextDocumentSyncKind.Incremental,
						referencesProvider: true,
						completionProvider: {
							resolveProvider: false,
							triggerCharacters: [
								// For SassDoc annotation completion
								"@",
								" ",
								"/",

								// For @use completion
								'"',
								"'",
							],
						},
						signatureHelpProvider: {
							triggerCharacters: ["(", ",", ";"],
						},
						hoverProvider: true,
						definitionProvider: true,
						workspaceSymbolProvider: true,
					},
				};
			},
		);

		this.connection.onInitialized(async () => {
			storageService = new StorageService();
			scannerService = new ScannerService(
				storageService,
				fileSystemProvider,
				settings,
			);

			const files = await fileSystemProvider.findFiles(
				"**/*.{scss,svelte,astro,vue}",
				settings.scannerExclude,
			);

			try {
				await scannerService.scan(files, workspaceRoot);
			} catch (error) {
				if (settings.showErrors) {
					this.connection.window.showErrorMessage(String(error));
				}
			}
		});

		documents.onDidChangeContent(async (change) => {
			try {
				await scannerService.update(change.document, workspaceRoot);
			} catch (error) {
				// Something went wrong trying to parse the changed document.
				console.error((error as Error).message);
				return;
			}

			const diagnostics = await doDiagnostics(change.document, storageService);

			// Check that no new version has been made while we waited
			const latestTextDocument = documents.get(change.document.uri);
			if (
				latestTextDocument &&
				latestTextDocument.version === change.document.version
			) {
				this.connection.sendDiagnostics({
					uri: latestTextDocument.uri,
					diagnostics,
				});
			}
		});

		this.connection.onDidChangeConfiguration((params) => {
			settings = params.settings.somesass;
		});

		this.connection.onDidChangeWatchedFiles(async (event) => {
			const newFiles: URI[] = [];
			for (const change of event.changes) {
				const uri = URI.parse(change.uri);
				if (change.type === FileChangeType.Deleted) {
					storageService.delete(uri);
				} else if (change.type === FileChangeType.Changed) {
					const document = storageService.get(uri);
					if (document) {
						await scannerService.update(document, workspaceRoot);
					} else {
						// New to us anyway
						newFiles.push(uri);
					}
				} else {
					newFiles.push(uri);
				}
			}
			return scannerService.scan(newFiles, workspaceRoot);
		});

		this.connection.onCompletion((textDocumentPosition) => {
			const uri = documents.get(textDocumentPosition.textDocument.uri);
			if (uri === undefined) {
				return;
			}

			const { document, offset } = getSCSSRegionsDocument(
				uri,
				textDocumentPosition.position,
			);
			if (!document) {
				return null;
			}

			return doCompletion(document, offset, settings, storageService);
		});

		this.connection.onHover((textDocumentPosition) => {
			const uri = documents.get(textDocumentPosition.textDocument.uri);
			if (uri === undefined) {
				return;
			}

			const { document, offset } = getSCSSRegionsDocument(
				uri,
				textDocumentPosition.position,
			);
			if (!document) {
				return null;
			}

			return doHover(document, offset, storageService);
		});

		this.connection.onSignatureHelp((textDocumentPosition) => {
			const uri = documents.get(textDocumentPosition.textDocument.uri);
			if (uri === undefined) {
				return;
			}

			const { document, offset } = getSCSSRegionsDocument(
				uri,
				textDocumentPosition.position,
			);
			if (!document) {
				return null;
			}

			return doSignatureHelp(document, offset, storageService);
		});

		this.connection.onDefinition((textDocumentPosition) => {
			const uri = documents.get(textDocumentPosition.textDocument.uri);
			if (uri === undefined) {
				return;
			}

			const { document, offset } = getSCSSRegionsDocument(
				uri,
				textDocumentPosition.position,
			);
			if (!document) {
				return null;
			}

			return goDefinition(document, offset, storageService);
		});

		this.connection.onReferences((referenceParams) => {
			const uri = documents.get(referenceParams.textDocument.uri);
			if (uri === undefined) {
				return undefined;
			}

			const { document, offset } = getSCSSRegionsDocument(
				uri,
				referenceParams.position,
			);
			if (!document) {
				return null;
			}

			const options = referenceParams.context;
			return provideReferences(document, offset, storageService, options);
		});

		this.connection.onWorkspaceSymbol((workspaceSymbolParams) => {
			return searchWorkspaceSymbol(
				workspaceSymbolParams.query,
				storageService,
				workspaceRoot.toString(),
			);
		});

		this.connection.onShutdown(() => {
			storageService.clear();
		});

		this.connection.listen();
	}
}