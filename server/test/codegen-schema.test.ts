import { describe, expect, it } from "vitest";
import { cleanDescription, normalizeSchema } from "../scripts/codegen/schema.js";
import spec from "./fixtures/mini-spec.json" with { type: "json" };

const components = spec.components.schemas as Record<string, unknown>;

describe("cleanDescription", () => {
  it("drops backend-column sentences and shortens Gorelo_PublicAPI type paths", () => {
    expect(cleanDescription("Ticket title.\r\nBackend column `Ticket.Title`.")).toBe("Ticket title.");
    expect(
      cleanDescription(
        "See Gorelo_PublicAPI.Tickets.Commands.CreateTicket.CreateTicketCommand.Title for rules.",
      ),
    ).toBe("See Title for rules.");
  });

  it("returns undefined for empty results and caps length at 400", () => {
    expect(cleanDescription("Backend column `X.Y`.")).toBeUndefined();
    expect(cleanDescription("a".repeat(500))?.length).toBe(400);
  });
});

describe("normalizeSchema", () => {
  const out = normalizeSchema({ $ref: "#/components/schemas/CreateTicketCommand" }, components);
  const props = out.properties as Record<string, Record<string, unknown>>;

  it("inlines $refs and keeps required/additionalProperties", () => {
    expect(out.type).toBe("object");
    expect(out.required).toEqual(["Title", "ClientId"]);
    expect(out.additionalProperties).toBe(false);
  });

  it("converts nullable to a type union and adds null to enums", () => {
    expect(props.DueOn).toEqual({ type: ["string", "null"], format: "date-time" });
    expect(props.Priority).toEqual({ type: ["integer", "null"], enum: [1, 2, 3, null] });
  });

  it("drops non-standard formats like int64", () => {
    expect(props.ClientId).toEqual({ type: "integer" });
  });

  it("stops recursive $refs instead of looping", () => {
    const parent = props.Parent as Record<string, unknown>;
    const child = (parent.properties as Record<string, Record<string, unknown>>).Child;
    expect(child).toEqual({ type: "object", description: "Node (recursive; nested fields omitted)" });
  });

  it("throws on an unresolved $ref", () => {
    expect(() => normalizeSchema({ $ref: "#/components/schemas/Missing" }, components)).toThrow(/Missing/);
  });
});
