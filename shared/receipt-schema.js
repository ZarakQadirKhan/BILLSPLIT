import { id } from "./calculations.js";

const object = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const text = (maxLength) => ({ type: "string", maxLength });
const amount = { type: ["integer", "null"], minimum: 0, maximum: 10000000000 };
const rate = { type: ["number", "null"], minimum: 0, maximum: 100 };
export const receiptSchema = object({
  title: text(120),
  items: {
    type: "array",
    minItems: 1,
    maxItems: 200,
    items: object({
      name: { ...text(200), minLength: 1 },
      quantity: { type: "number", exclusiveMinimum: 0, maximum: 10000 },
      unitPriceCents: amount,
      lineTotalCents: amount,
      eligible: { type: "boolean" },
      uncertain: { type: "boolean" },
    }),
  },
  charges: object({
    discountCents: amount,
    discountRate: rate,
    eligibleCapCents: amount,
    maxDiscountCents: amount,
    taxCents: amount,
    taxRate: rate,
    taxBasis: { type: ["string", "null"], enum: ["before", "after", null] },
    deliveryCents: amount,
    serviceCents: amount,
    tipCents: amount,
  }),
  receiptTotalCents: amount,
  warnings: { type: "array", maxItems: 30, items: text(300) },
});

// Validate the same schema sent to Gemini. Never trust model output as bill data.
function check(value, schema, path = "receipt") {
  if (value === null && [].concat(schema.type).includes("null")) return;
  const type =
    schema.type instanceof Array
      ? schema.type.find((t) => t !== "null")
      : schema.type;
  if (schema.enum && !schema.enum.includes(value))
    throw Error(`Invalid receipt enum at ${path}`);
  if (type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error(`Invalid receipt object at ${path}`);
    if (Object.keys(value).some((k) => !Object.hasOwn(schema.properties, k)))
      throw Error("Unexpected receipt field");
    for (const key of schema.required)
      check(value[key], schema.properties[key], `${path}.${key}`);
  } else if (type === "array") {
    if (
      !Array.isArray(value) ||
      value.length < (schema.minItems || 0) ||
      value.length > schema.maxItems
    )
      throw Error(`Invalid receipt list at ${path}`);
    value.forEach((v) => check(v, schema.items, `${path}[]`));
  } else if (type === "string") {
    if (
      typeof value !== "string" ||
      value.length > schema.maxLength ||
      value.trim().length < (schema.minLength || 0)
    )
      throw Error(`Invalid receipt text at ${path}`);
  } else if (type === "boolean") {
    if (typeof value !== "boolean") throw Error(`Invalid receipt flag at ${path}`);
  } else if (
    !Number.isFinite(value) ||
    (type === "integer" && !Number.isSafeInteger(value)) ||
    value < (schema.minimum ?? -Infinity) ||
    value <= (schema.exclusiveMinimum ?? -Infinity) ||
    value > schema.maximum
  )
    throw Error(`Invalid receipt number at ${path}`);
}

export function normalizeReceipt(value) {
  check(value, receiptSchema);
  const warnings = [...value.warnings];
  const items = value.items.map((item) => {
    if (item.unitPriceCents == null && item.lineTotalCents == null)
      throw Error("Unreadable item price");
    const unitPriceCents =
      item.unitPriceCents ?? Math.round(item.lineTotalCents / item.quantity);
    check(unitPriceCents, amount);
    if (
      item.lineTotalCents != null &&
      item.lineTotalCents !== Math.round(item.quantity * unitPriceCents)
    )
      warnings.push(
        `Check ${item.name}: printed line total differs from quantity × price.`,
      );
    return { ...item, id: id(), unitPriceCents, allocations: [] };
  });
  if (value.receiptTotalCents == null)
    warnings.push(
      "No final total found. Enter the amount charged from the receipt.",
    );
  if (
    value.charges.taxCents == null &&
    value.charges.taxRate != null &&
    value.charges.taxBasis == null
  )
    warnings.push("Check whether tax applies before or after the discount.");
  return { ...value, items, warnings: warnings.slice(0, 30) };
}
