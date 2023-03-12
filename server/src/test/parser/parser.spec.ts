import { strictEqual, deepStrictEqual, ok } from "assert";
import { stub, SinonStub } from "sinon";
import { FileType } from "vscode-css-languageservice";
import { URI } from "vscode-uri";
import { parseDocument, reForward, reModuleAtRule, reUse } from "../../parser";
import StorageService from "../../storage";
import * as helpers from "../helpers";
import { TestFileSystem } from "../test-file-system";

const storage = new StorageService();
const fs = new TestFileSystem(storage);

describe("Services/Parser", () => {
	describe(".parseDocument", () => {
		let statStub: SinonStub;
		let fileExistsStub: SinonStub;

		beforeEach(() => {
			fileExistsStub = stub(fs, "exists");
			statStub = stub(fs, "stat").yields(null, {
				type: FileType.Unknown,
				ctime: -1,
				mtime: -1,
				size: -1,
			});
		});

		afterEach(() => {
			fileExistsStub.restore();
			statStub.restore();
		});

		it("should return symbols", async () => {
			const document = await helpers.makeDocument(
				storage,
				[
					'$name: "value";',
					"@mixin mixin($a: 1, $b) {}",
					"@function function($a: 1, $b) {}",
				],
				fs,
			);

			const symbols = await parseDocument(document, URI.parse(""), fs, {});

			// Variables
			const variables = [...symbols.variables.values()];
			strictEqual(variables.length, 1);

			strictEqual(variables[0]?.name, "$name");
			strictEqual(variables[0]?.value, '"value"');

			// Mixins
			const mixins = [...symbols.mixins.values()];
			strictEqual(mixins.length, 1);

			strictEqual(mixins[0]?.name, "mixin");
			strictEqual(mixins[0]?.parameters.length, 2);

			strictEqual(mixins[0]?.parameters[0]?.name, "$a");
			strictEqual(mixins[0]?.parameters[0]?.value, "1");

			strictEqual(mixins[0]?.parameters[1]?.name, "$b");
			strictEqual(mixins[0]?.parameters[1]?.value, null);

			// Functions
			const functions = [...symbols.functions.values()];
			strictEqual(functions.length, 1);

			strictEqual(functions[0]?.name, "function");
			strictEqual(functions[0]?.parameters.length, 2);

			strictEqual(functions[0]?.parameters[0]?.name, "$a");
			strictEqual(functions[0]?.parameters[0]?.value, "1");

			strictEqual(functions[0]?.parameters[1]?.name, "$b");
			strictEqual(functions[0]?.parameters[1]?.value, null);
		});

		it("should return links", async () => {
			fileExistsStub.resolves(true);

			await helpers.makeDocument(storage, ["$var: 1px;"], fs, {
				uri: "variables.scss",
			});
			await helpers.makeDocument(storage, ["$tr: 2px;"], fs, {
				uri: "corners.scss",
			});
			await helpers.makeDocument(storage, ["$b: #000;"], fs, {
				uri: "color.scss",
			});

			const document = await helpers.makeDocument(
				storage,
				[
					'@use "variables" as vars;',
					'@use "corners" as *;',
					'@forward "colors" as color-* hide $varslingsfarger, varslingsfarge;',
				],
				fs,
			);

			const symbols = await parseDocument(document, URI.parse(""), fs, {});

			// Uses
			const uses = [...symbols.uses.values()];
			strictEqual(uses.length, 2, "expected to find two uses");
			strictEqual(uses[0]?.namespace, "vars");
			strictEqual(uses[0]?.isAliased, true);

			strictEqual(uses[1]?.namespace, "*");
			strictEqual(uses[1]?.isAliased, true);

			// Forward
			const forwards = [...symbols.forwards.values()];
			strictEqual(forwards.length, 1, "expected to find one forward");
			strictEqual(forwards[0]?.prefix, "color-");
			deepStrictEqual(forwards[0]?.hide, [
				"$varslingsfarger",
				"varslingsfarge",
			]);
		});

		it("should return relative links", async () => {
			fileExistsStub.resolves(true);

			await helpers.makeDocument(storage, ["$var: 1px;"], fs, {
				uri: "upper.scss",
			});
			await helpers.makeDocument(storage, ["$b: #000;"], fs, {
				uri: "middle/middle.scss",
			});
			await helpers.makeDocument(storage, ["$tr: 2px;"], fs, {
				uri: "middle/lower/lower.scss",
			});

			const document = await helpers.makeDocument(
				storage,
				['@use "../upper";', '@use "./middle";', '@use "./lower/lower";'],
				fs,
				{ uri: "middle/main.scss" },
			);

			const symbols = await parseDocument(document, URI.parse(""), fs, {});
			const uses = [...symbols.uses.values()];

			strictEqual(uses.length, 3, "expected to find three uses");
		});

		it("should not crash on link to the same document", async () => {
			const document = await helpers.makeDocument(
				storage,
				['@use "./self";', "$var: 1px;"],
				fs,
				{
					uri: "self.scss",
				},
			);
			const symbols = await parseDocument(document, URI.parse(""), fs, {});
			const uses = [...symbols.uses.values()];
			const variables = [...symbols.variables.values()];

			strictEqual(variables.length, 1, "expected to find one variable");
			strictEqual(uses.length, 0, "expected to find no use link to self");
		});
	});

	describe("regular expressions", () => {
		it("for detecting module at rules", () => {
			ok(reModuleAtRule.test('@use "file";'), "should match a basic @use");
			ok(
				reModuleAtRule.test('  @use "file";'),
				"should match an indented @use",
			);
			ok(
				reModuleAtRule.test('@use "~file";'),
				"should match @use from node_modules",
			);
			ok(
				reModuleAtRule.test("@use 'file';"),
				"should match @use with single quotes",
			);
			ok(
				reModuleAtRule.test('@use "../file";'),
				"should match relative @use one level up",
			);
			ok(
				reModuleAtRule.test('@use "../../../file";'),
				"should match relative @use several levels up",
			);
			ok(
				reModuleAtRule.test('@use "./file/other";'),
				"should match relative @use one level down",
			);
			ok(
				reModuleAtRule.test('@use "./file/yet/another";'),
				"should match relative @use several levels down",
			);

			ok(
				reModuleAtRule.test('@forward "file";'),
				"should match a basic @forward",
			);
			ok(
				reModuleAtRule.test('  @forward "file";'),
				"should match an indented @forward",
			);
			ok(
				reModuleAtRule.test('@forward "~file";'),
				"should match @forward from node_modules",
			);
			ok(
				reModuleAtRule.test("@forward 'file';"),
				"should match @forward with single quotes",
			);
			ok(
				reModuleAtRule.test('@forward "../file";'),
				"should match relative @forward one level up",
			);
			ok(
				reModuleAtRule.test('@forward "../../../file";'),
				"should match relative @forward several levels up",
			);
			ok(
				reModuleAtRule.test('@forward "./file/other";'),
				"should match relative @forward one level down",
			);
			ok(
				reModuleAtRule.test('@forward "./file/yet/another";'),
				"should match relative @forward several levels down",
			);

			ok(
				reModuleAtRule.test('@import "file";'),
				"should match a basic @import",
			);
			ok(
				reModuleAtRule.test('  @import "file";'),
				"should match an indented @import",
			);
			ok(
				reModuleAtRule.test('@import "~file";'),
				"should match @import from node_modules",
			);
			ok(
				reModuleAtRule.test("@import 'file';"),
				"should match @import with single quotes",
			);
			ok(
				reModuleAtRule.test('@import "../file";'),
				"should match relative @import one level up",
			);
			ok(
				reModuleAtRule.test('@import "../../../file";'),
				"should match relative @import several levels up",
			);
			ok(
				reModuleAtRule.test('@import "./file/other";'),
				"should match relative @import one level down",
			);
			ok(
				reModuleAtRule.test('@import "./file/yet/another";'),
				"should match relative @import several levels down",
			);
		});

		it("for use", () => {
			ok(reUse.test('@use "file";'), "should match a basic @use");
			ok(reUse.test('  @use "file";'), "should match an indented @use");
			ok(reUse.test('@use "~file";'), "should match @use from node_modules");
			ok(reUse.test("@use 'file';"), "should match @use with single quotes");
			ok(
				reUse.test('@use "../file";'),
				"should match relative @use one level up",
			);
			ok(
				reUse.test('@use "../../../file";'),
				"should match relative @use several levels up",
			);
			ok(
				reUse.test('@use "./file/other";'),
				"should match relative @use one level down",
			);
			ok(
				reUse.test('@use "./file/yet/another";'),
				"should match relative @use several levels down",
			);

			ok(
				reUse.test('@use "variables" as vars;'),
				"should match a @use with an alias",
			);
			ok(
				reUse.test('@use "src/corners" as *;'),
				"should match a @use with a wildcard as alias",
			);

			const match = reUse.exec('@use "variables" as vars;');
			strictEqual(match!.groups!["url"] as string, "variables");
			strictEqual(match!.groups!["namespace"] as string, "vars");
		});

		it("for forward", () => {
			ok(reForward.test('@forward "file";'), "should match a basic @forward");
			ok(
				reForward.test('  @forward "file";'),
				"should match an indented @forward",
			);
			ok(
				reForward.test('@forward "~file";'),
				"should match @forward from node_modules",
			);
			ok(
				reForward.test("@forward 'file';"),
				"should match @forward with single quotes",
			);
			ok(
				reForward.test('@forward "../file";'),
				"should match relative @forward one level up",
			);
			ok(
				reForward.test('@forward "../../../file";'),
				"should match relative @forward several levels up",
			);
			ok(
				reForward.test('@forward "./file/other";'),
				"should match relative @forward one level down",
			);
			ok(
				reForward.test('@forward "./file/yet/another";'),
				"should match relative @forward several levels down",
			);

			ok(
				reForward.test(
					'@forward "colors" as color-* hide $varslingsfarger, varslingsfarge;',
				),
				"should match a @forward with an alias and several hide",
			);
			ok(
				reForward.test('@forward "shadow";'),
				"should match a @forward with no alias and no hide",
			);
			ok(
				reForward.test('@forward "spacing" hide $spacing-new;'),
				"should match a @forward with no alias and a hide",
			);

			const match = reForward.exec(
				'@forward "colors" as color-* hide $varslingsfarger, varslingsfarge;',
			);
			strictEqual(match!.groups!["url"] as string, "colors");
			strictEqual(match!.groups!["prefix"] as string, "color-");
			strictEqual(
				match!.groups!["hide"] as string,
				"$varslingsfarger, varslingsfarge",
			);
		});
	});
});
