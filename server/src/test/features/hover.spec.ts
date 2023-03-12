import { deepStrictEqual } from "assert";
import { MarkupKind, SymbolKind } from "vscode-languageserver";
import type { Hover } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { doHover } from "../../features/hover/hover";
import { INode, ScssDocument } from "../../parser";
import { getLanguageService } from "../../parser/language-service";
import StorageService from "../../storage";
import * as helpers from "../helpers";
import { TestFileSystem } from "../test-file-system";

const storage = new StorageService();
const fs = new TestFileSystem(storage);

const document = TextDocument.create("./one.scss", "scss", 1, "");
const ls = getLanguageService(fs, {});
const ast = ls.parseStylesheet(document) as INode;

storage.set(
	"file.scss",
	new ScssDocument(
		fs,
		TextDocument.create("./file.scss", "scss", 1, ""),
		{
			variables: new Map([
				[
					"$variable",
					{
						name: "$variable",
						kind: SymbolKind.Variable,
						value: "2",
						offset: 0,
						position: { line: 1, character: 1 },
					},
				],
			]),
			mixins: new Map([
				[
					"mixin",
					{
						name: "mixin",
						kind: SymbolKind.Method,
						parameters: [],
						offset: 0,
						position: { line: 1, character: 1 },
					},
				],
			]),
			functions: new Map([
				[
					"func",
					{
						name: "func",
						kind: SymbolKind.Function,
						parameters: [],
						offset: 0,
						position: { line: 1, character: 1 },
					},
				],
			]),
			imports: new Map(),
			uses: new Map(),
			forwards: new Map(),
		},
		ast,
	),
);

async function getHover(lines: string[]): Promise<Hover | null> {
	let text = lines.join("\n");
	const offset = text.indexOf("|");
	text = text.replace("|", "");

	const document = await helpers.makeDocument(storage, text, fs);

	return doHover(document, offset, storage);
}

describe("Providers/Hover", () => {
	it("should suggest local symbols", async () => {
		const actual = await getHover(["$one: 1;", ".a { content: $one|; }"]);

		deepStrictEqual(actual?.contents, {
			kind: MarkupKind.Markdown,
			value: [
				"```scss",
				"$one: 1;",
				"```",
				"____",
				"Variable declared in index.scss",
			].join("\n"),
		});
	});

	it("should suggest global variables", async () => {
		const actual = await getHover([".a { content: $variable|; }"]);

		deepStrictEqual(actual?.contents, {
			kind: MarkupKind.Markdown,
			value: [
				"```scss",
				"$variable: 2;",
				"```",
				"____",
				"Variable declared in file.scss",
			].join("\n"),
		});
	});

	it("should suggest global mixins", async () => {
		const actual = await getHover([".a { @include mixin| }"]);

		deepStrictEqual(actual?.contents, {
			kind: MarkupKind.Markdown,
			value: [
				"```scss",
				"@mixin mixin()",
				"```",
				"____",
				"Mixin declared in file.scss",
			].join("\n"),
		});
	});

	it("should suggest global functions", async () => {
		const actual = await getHover([".a {", "	width: func|();", "}"]);

		deepStrictEqual(actual?.contents, {
			kind: MarkupKind.Markdown,
			value: [
				"```scss",
				"@function func()",
				"```",
				"____",
				"Function declared in file.scss",
			].join("\n"),
		});
	});
});
