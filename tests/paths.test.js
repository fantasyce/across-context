import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { defaultHome, ecosystemBinDir, ecosystemHome, pluginRoot } from "../src/paths.js";

test("default paths live under ACROSS_HOME component namespaces", async () => {
  const acrossHomePath = await mkdtemp(join(tmpdir(), "across-home-"));
  const env = { ACROSS_HOME: acrossHomePath };

  assert.equal(ecosystemHome(env), acrossHomePath);
  assert.equal(defaultHome(env), join(acrossHomePath, "data", "across-context"));
  assert.equal(pluginRoot(env), join(acrossHomePath, "plugins"));
  assert.equal(ecosystemBinDir(env), join(acrossHomePath, "bin"));
});

test("ACROSS_CONTEXT_HOME remains an explicit vault override", async () => {
  const acrossHomePath = await mkdtemp(join(tmpdir(), "across-home-"));
  const override = await mkdtemp(join(tmpdir(), "across-context-override-"));

  assert.equal(
    defaultHome({ ACROSS_HOME: acrossHomePath, ACROSS_CONTEXT_HOME: override }),
    override
  );
});
