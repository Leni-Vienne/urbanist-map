import { describe, expect, test } from "bun:test";
import { isAllowedCorsOrigin, parseAllowedDomains } from "./corsConfig";

describe("parseAllowedDomains", () => {
  test("accepts configured origins and bare domains", () => {
    expect(
      parseAllowedDomains("https://urbanistmap.org, preview.construction-map-preview.pages.dev"),
    ).toEqual(["urbanistmap.org", "preview.construction-map-preview.pages.dev"]);
  });
});

describe("isAllowedCorsOrigin", () => {
  const domains = ["urbanistmap.org"];

  test("accepts the HTTPS root and its subdomains", () => {
    expect(isAllowedCorsOrigin("https://urbanistmap.org", domains)).toBe(true);
    expect(isAllowedCorsOrigin("https://preview.urbanistmap.org", domains)).toBe(true);
  });

  test("rejects insecure, malformed, and suffix-confusion origins", () => {
    expect(isAllowedCorsOrigin("http://preview.urbanistmap.org", domains)).toBe(false);
    expect(isAllowedCorsOrigin("https://urbanistmap.org.example.com", domains)).toBe(false);
    expect(isAllowedCorsOrigin("not an origin", domains)).toBe(false);
  });
});
