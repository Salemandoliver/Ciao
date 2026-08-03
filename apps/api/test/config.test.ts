/**
 * Origin-list parsing.
 *
 * This exists because of a real deploy: `CORS_ORIGINS` was set correctly on the
 * hosting dashboard, the API restarted, and the partner app still could not
 * reach it. `@fastify/cors` compares origins by exact string, so a single space
 * after the comma produced `" https://partners…"` and matched nothing — with no
 * error in any log, because nothing had gone wrong as far as the server was
 * concerned. The browser just said the server was unreachable.
 */
import { describe, expect, it } from "vitest";
import { parseOrigins } from "../src/config.js";

describe("parseOrigins", () => {
  it("splits a plain list", () => {
    expect(parseOrigins("https://a.example,https://b.example")).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });

  it("tolerates the spaces a human types after a comma", () => {
    expect(parseOrigins("https://a.example, https://b.example")).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });

  it("tolerates a trailing slash copied from a browser address bar", () => {
    // Copying the domain out of Railway's dashboard gives you the slash.
    expect(parseOrigins("https://a.example/,https://b.example//")).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });

  it("drops empties from a trailing comma rather than allowing ''", () => {
    // An empty entry is not merely useless: it is an origin value that some
    // clients send, so keeping it would widen the allow-list by accident.
    expect(parseOrigins("https://a.example,,")).toEqual(["https://a.example"]);
  });

  it("survives newlines from a multi-line paste", () => {
    expect(parseOrigins("https://a.example,\nhttps://b.example\n")).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });
});
