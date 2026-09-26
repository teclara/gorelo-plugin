import { describe, expect, it } from "vitest";
import { INSTRUCTIONS } from "../src/instructions.js";

describe("server instructions", () => {
  it("tell Claude to verify before retrying a failed or timed-out write", () => {
    expect(INSTRUCTIONS).toContain(
      "After a failed or timed-out write, verify with a read before retrying — never blindly repeat a write.",
    );
  });

  it("describe the list result shape", () => {
    expect(INSTRUCTIONS).toContain("{count, has_more, next_cursor, items}");
  });
});
