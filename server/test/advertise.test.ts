import { describe, expect, it } from "vitest";
import { leanSchema, shorten } from "../src/advertise.js";

describe("shorten", () => {
  it("returns short text unchanged", () => {
    expect(shorten("Ticket title.", 120)).toBe("Ticket title.");
  });

  it("keeps whole sentences up to the limit", () => {
    const text = "When the work started. Supply any two of the three time fields. The rest is long detail.";
    expect(shorten(text, 70)).toBe("When the work started. Supply any two of the three time fields.");
  });

  it("cuts an over-long first sentence at a word boundary and marks the cut", () => {
    const out = shorten("Keyword matched against the client name, alternate name and billing name", 40);
    expect(out).toBe("Keyword matched against the client…");
  });

  it("removes backend storage notes and markup", () => {
    expect(shorten("How often the check runs. Backend column `NodeCheck.Frequency`.", 120)).toBe(
      "How often the check runs.",
    );
    expect(shorten("Link to the page. Backend column\n `NodeCheck.Link`, NVarChar(500).", 120)).toBe(
      "Link to the page.",
    );
    expect(shorten("Send **either** this or <c>TaskId</c>.", 120)).toBe("Send either this or TaskId.");
  });

  it("returns undefined when nothing is left", () => {
    expect(shorten("Backend column `A.B`.", 120)).toBeUndefined();
  });
});

describe("leanSchema", () => {
  const full = {
    type: "object",
    description: "never shown",
    properties: {
      ticketId: { type: "string", format: "uuid", description: "Ticket identifier." },
      UpdatedSince: { type: "string", format: "date-time", description: "ISO-8601 timestamp; keeps newer." },
      ClientIds: {
        type: "string",
        description: "Comma-separated client ids to include. Omit for every client.",
      },
      PriorityIds: { type: "string", description: "Comma-separated priority ids: Urgent=1, High=2." },
      body: {
        type: "object",
        description: "Request body for creating a thing.",
        properties: {
          PriorityId: {
            type: "integer",
            enum: [0, 1, 2],
            default: 0,
            description: "0 None, 1 Urgent, 2 High.",
          },
          Note: {
            type: ["string", "null"],
            minLength: 1,
            description: `First sentence. ${"x".repeat(200)}.`,
          },
          Lines: {
            type: "array",
            items: {
              type: "object",
              properties: {
                TaxId: {
                  type: ["integer", "null"],
                  description:
                    "Tax to apply to this line. Falls back to the item's own tax when omitted; send null for none.",
                },
              },
              required: ["TaxId"],
              additionalProperties: false,
            },
          },
        },
        required: ["PriorityId"],
        additionalProperties: false,
      },
    },
    required: ["ticketId"],
    additionalProperties: false,
  };
  const lean = leanSchema(full, ["ticketId"]) as any;

  it("keeps names, types, formats, enums, defaults, constraints and required lists", () => {
    expect(Object.keys(lean.properties)).toEqual(Object.keys(full.properties));
    expect(lean.required).toEqual(["ticketId"]);
    expect(lean.properties.ticketId).toEqual({ type: "string", format: "uuid" });
    expect(lean.properties.body.required).toEqual(["PriorityId"]);
    expect(lean.properties.body.properties.PriorityId).toEqual({
      type: "integer",
      enum: [0, 1, 2],
      default: 0,
      description: "0 None, 1 Urgent, 2 High.",
    });
    expect(lean.properties.body.properties.Note).toMatchObject({ type: ["string", "null"], minLength: 1 });
    expect(lean.properties.body.properties.Lines.items.required).toEqual(["TaxId"]);
  });

  it("drops descriptions that repeat the name, and the object-level ones", () => {
    expect(lean.description).toBeUndefined();
    expect(lean.properties.body.description).toBeUndefined();
    expect(lean.properties.UpdatedSince).toEqual({ type: "string", format: "date-time" });
    expect(lean.properties.ClientIds).toEqual({ type: "string" });
  });

  it("keeps an id filter's description when it carries the id meanings", () => {
    expect(lean.properties.PriorityIds.description).toBe("Comma-separated priority ids: Urgent=1, High=2.");
  });

  it("shortens long descriptions, more so when nested", () => {
    expect(lean.properties.body.properties.Note.description).toBe("First sentence.");
    expect(lean.properties.body.properties.Lines.items.properties.TaxId.description).toBe(
      "Tax to apply to this line.",
    );
  });

  it("leaves additionalProperties: false to the validator", () => {
    expect(JSON.stringify(lean)).not.toContain("additionalProperties");
    expect(leanSchema({ type: "object", additionalProperties: { type: "string" } })).toEqual({
      type: "object",
      additionalProperties: { type: "string" },
    });
  });

  it("does not modify the schema it is given", () => {
    expect(full.properties.body.additionalProperties).toBe(false);
    expect(full.properties.ticketId.description).toBe("Ticket identifier.");
  });
});
