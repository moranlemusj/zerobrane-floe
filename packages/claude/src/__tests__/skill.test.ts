import { describe, expect, it } from "vitest";
import { FLOE_SKILL_MARKDOWN, floeSystemPrompt } from "../skill.js";

describe("FLOE_SKILL_MARKDOWN", () => {
  it("communicates the facilitator model (no manual borrow)", () => {
    expect(FLOE_SKILL_MARKDOWN).toMatch(/facilitator/);
    expect(FLOE_SKILL_MARKDOWN).toMatch(/do not manually borrow/i);
  });

  it("teaches the reflection-flag reading", () => {
    expect(FLOE_SKILL_MARKDOWN).toMatch(/willExceedAvailable/);
    expect(FLOE_SKILL_MARKDOWN).toMatch(/willExceedHeadroom/);
    expect(FLOE_SKILL_MARKDOWN).toMatch(/willExceedSpendLimit/);
  });

  it("warns about not surfacing balances unprompted", () => {
    expect(FLOE_SKILL_MARKDOWN).toMatch(/unless the user asks/i);
  });
});

describe("floeSystemPrompt", () => {
  it("returns claude_code preset by default", () => {
    const result = floeSystemPrompt();
    expect(typeof result).toBe("object");
    if (typeof result !== "string") {
      expect(result.type).toBe("preset");
      expect(result.preset).toBe("claude_code");
      expect(result.append).toContain(FLOE_SKILL_MARKDOWN);
    }
  });

  it("returns plain string when withClaudeCodePreset is false", () => {
    const result = floeSystemPrompt({ withClaudeCodePreset: false });
    expect(typeof result).toBe("string");
    if (typeof result === "string") {
      expect(result).toContain(FLOE_SKILL_MARKDOWN);
    }
  });

  it("appends user content after the skill markdown", () => {
    const extra = "Custom guidance.";
    const result = floeSystemPrompt({ append: extra });
    if (typeof result !== "string") {
      expect(result.append).toContain(FLOE_SKILL_MARKDOWN);
      expect(result.append).toContain(extra);
      expect(result.append.indexOf(extra)).toBeGreaterThan(
        result.append.indexOf(FLOE_SKILL_MARKDOWN.slice(0, 30)),
      );
    }
  });
});
