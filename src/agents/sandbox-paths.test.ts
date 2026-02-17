import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { assertMediaNotDataUrl, resolveSandboxedMediaSource } from "./sandbox-paths.js";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    }),
  );
});

describe("sandbox media path guards", () => {
  it("allows http and https media URLs unchanged", async () => {
    const sandboxRoot = await makeTempDir("openclaw-sandbox-");

    const http = await resolveSandboxedMediaSource({
      media: "http://example.com/file.png",
      sandboxRoot,
    });
    const https = await resolveSandboxedMediaSource({
      media: "https://example.com/file.png",
      sandboxRoot,
    });

    expect(http).toBe("http://example.com/file.png");
    expect(https).toBe("https://example.com/file.png");
  });

  it("normalizes in-sandbox relative paths", async () => {
    const sandboxRoot = await makeTempDir("openclaw-sandbox-");

    const resolved = await resolveSandboxedMediaSource({
      media: "./media/pic.png",
      sandboxRoot,
    });

    expect(resolved).toBe(path.join(sandboxRoot, "media", "pic.png"));
  });

  it("rejects traversal outside the sandbox root", async () => {
    const sandboxRoot = await makeTempDir("openclaw-sandbox-");

    await expect(
      resolveSandboxedMediaSource({
        media: "../secret.txt",
        sandboxRoot,
      }),
    ).rejects.toThrow(/sandbox root/i);
  });

  it("rejects absolute paths outside the sandbox root", async () => {
    const sandboxRoot = await makeTempDir("openclaw-sandbox-");
    const outsideRoot = await makeTempDir("openclaw-outside-");
    const outsideFile = path.join(outsideRoot, "secret.txt");
    await fs.writeFile(outsideFile, "secret");

    await expect(
      resolveSandboxedMediaSource({
        media: outsideFile,
        sandboxRoot,
      }),
    ).rejects.toThrow(/sandbox root/i);
  });

  it("rejects file URLs outside the sandbox root", async () => {
    const sandboxRoot = await makeTempDir("openclaw-sandbox-");
    const outsideRoot = await makeTempDir("openclaw-outside-");
    const outsideFile = path.join(outsideRoot, "secret.txt");
    await fs.writeFile(outsideFile, "secret");

    await expect(
      resolveSandboxedMediaSource({
        media: pathToFileURL(outsideFile).toString(),
        sandboxRoot,
      }),
    ).rejects.toThrow(/sandbox root/i);
  });

  it("accepts file URLs inside the sandbox root", async () => {
    const sandboxRoot = await makeTempDir("openclaw-sandbox-");
    const insideFile = path.join(sandboxRoot, "media", "note.txt");
    await fs.mkdir(path.dirname(insideFile), { recursive: true });
    await fs.writeFile(insideFile, "ok");

    const resolved = await resolveSandboxedMediaSource({
      media: pathToFileURL(insideFile).toString(),
      sandboxRoot,
    });

    expect(resolved).toBe(insideFile);
  });

  it("rejects paths that cross symlinks inside the sandbox root", async () => {
    const sandboxRoot = await makeTempDir("openclaw-sandbox-");
    const outsideRoot = await makeTempDir("openclaw-outside-");
    const outsideFile = path.join(outsideRoot, "secret.txt");
    await fs.writeFile(outsideFile, "secret");

    const linkPath = path.join(sandboxRoot, "link");
    try {
      await fs.symlink(outsideRoot, linkPath, process.platform === "win32" ? "junction" : "dir");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EACCES" || code === "ENOSYS") {
        return;
      }
      throw err;
    }

    await expect(
      resolveSandboxedMediaSource({
        media: "./link/secret.txt",
        sandboxRoot,
      }),
    ).rejects.toThrow(/symlink/i);
  });

  it("rejects data URLs as media input", () => {
    expect(() => assertMediaNotDataUrl("data:image/png;base64,abcd")).toThrow(/data:/i);
  });
});
