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

test("product mode ignores protected ecosystem runtime roots", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-product-home-"));
  const env = {
    HOME: home,
    ACROSS_CONTEXT_PRODUCT_MODE: "1",
    ACROSS_HOME: join(home, "Documents", "projects", "across"),
    ACROSS_PLUGIN_HOME: join(home, "Documents", "projects", "plugins"),
    ACROSS_BIN_HOME: join(home, "Documents", "projects", "bin"),
    ACROSS_CONTEXT_HOME: join(home, "Documents", "projects", "context-data")
  };

  assert.equal(ecosystemHome(env), join(home, ".across"));
  assert.equal(pluginRoot(env), join(home, ".across", "plugins"));
  assert.equal(ecosystemBinDir(env), join(home, ".across", "bin"));
  assert.equal(defaultHome(env), join(home, ".across", "data", "across-context"));
});

test("product mode preserves similarly named user directories", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-adjacent-home-"));
  const env = {
    HOME: home,
    ACROSS_CONTEXT_PRODUCT_MODE: "1",
    ACROSS_HOME: join(home, "DocumentsArchive", "across")
  };

  assert.equal(ecosystemHome(env), env.ACROSS_HOME);
});

test("developer mode preserves protected ecosystem runtime roots", async () => {
  const home = await mkdtemp(join(tmpdir(), "across-context-dev-home-"));
  const env = {
    HOME: home,
    ACROSS_CONTEXT_PRODUCT_MODE: "1",
    ACROSS_CONTEXT_DEVELOPER_MODE: "1",
    ACROSS_HOME: join(home, "Documents", "projects", "across"),
    ACROSS_PLUGIN_HOME: join(home, "Documents", "projects", "plugins"),
    ACROSS_BIN_HOME: join(home, "Documents", "projects", "bin"),
    ACROSS_CONTEXT_HOME: join(home, "Documents", "projects", "context-data")
  };

  assert.equal(ecosystemHome(env), env.ACROSS_HOME);
  assert.equal(pluginRoot(env), env.ACROSS_PLUGIN_HOME);
  assert.equal(ecosystemBinDir(env), env.ACROSS_BIN_HOME);
  assert.equal(defaultHome(env), env.ACROSS_CONTEXT_HOME);
});
