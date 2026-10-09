import { describe, expect, it } from "vitest";
import { parseSpreadsheet } from "../../src/lib/parser.js";
import ExcelJS from "exceljs";

describe("parseSpreadsheet", () => {
  it("parses a simple CSV file", async () => {
    const csvContent = "name,age,city\nAlice,30,NYC\nBob,25,LA\nCarol,35,Chicago";
    const buffer = Buffer.from(csvContent);

    const result = await parseSpreadsheet(buffer, "data.csv");

    expect(result.headers).toEqual(["name", "age", "city"]);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toEqual(["Alice", "30", "NYC"]);
    expect(result.rows[1]).toEqual(["Bob", "25", "LA"]);
    expect(result.rows[2]).toEqual(["Carol", "35", "Chicago"]);
    expect(result.sheetName).toBe("data.csv");
  });

  it("parses CSV with quoted fields", async () => {
    const csvContent = 'name,description\n"Alice","Likes ""quotes"""\n"Bob","Simple text"';
    const buffer = Buffer.from(csvContent);

    const result = await parseSpreadsheet(buffer, "data.csv");

    expect(result.headers).toEqual(["name", "description"]);
    expect(result.rows[0]?.[1]).toContain("quotes");
  });

  it("parses CSV with empty fields", async () => {
    const csvContent = "a,b,c\n1,,3\n,2,\n4,5,6";
    const buffer = Buffer.from(csvContent);

    const result = await parseSpreadsheet(buffer, "data.csv");

    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toEqual(["1", "", "3"]);
    expect(result.rows[1]).toEqual(["", "2", ""]);
  });

  it("parses an Excel file", async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Sales");
    worksheet.addRow(["Product", "Quantity", "Price"]);
    worksheet.addRow(["Widget", 10, 9.99]);
    worksheet.addRow(["Gadget", 5, 19.99]);

    const buffer = await workbook.xlsx.writeBuffer();

    const result = await parseSpreadsheet(buffer as unknown as Buffer, "data.xlsx");

    expect(result.headers).toEqual(["Product", "Quantity", "Price"]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.[0]).toBe("Widget");
    expect(result.sheetName).toBe("Sales");
  });

it("uses first sheet from Excel workbook", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Sheet1").addRow(["A", "B"]);
    workbook.addWorksheet("Sheet2").addRow(["C", "D"]);
    const first = workbook.getWorksheet("Sheet1");
    first?.addRow(["X", "Y"]);

    const buffer = await workbook.xlsx.writeBuffer();

    const result = await parseSpreadsheet(buffer as unknown as Buffer, "multi.xlsx");

    expect(result.sheetName).toBe("Sheet1");
    expect(result.headers).toEqual(["A", "B"]);
  });

  it("handles Excel file with empty rows", async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Data");
    worksheet.addRow(["Name", "Value"]);
    worksheet.addRow(["Alice", 100]);
    worksheet.addRow([null, null]); // Empty row
    worksheet.addRow(["Bob", 200]);

    const buffer = await workbook.xlsx.writeBuffer();

    const result = await parseSpreadsheet(buffer as unknown as Buffer, "data.xlsx");

    // Should filter out completely empty rows
    expect(result.rows.length).toBeLessThanOrEqual(3);
  });

it("enforces 200k row cap", async () => {
    const headers = "a,b,c\n";
    const rows = Array.from({ length: 250000 }, (_, i) => `${i},${i + 1},${i + 2}`).join("\n");
    const csvContent = headers + rows;
    const buffer = Buffer.from(csvContent);

    await expect(parseSpreadsheet(buffer, "huge.csv")).rejects.toThrow();
  });

  it("handles CSV with BOM", async () => {
    const bom = "﻿";
    const csvContent = bom + "name,value\ntest,123";
    const buffer = Buffer.from(csvContent);

    const result = await parseSpreadsheet(buffer, "bom.csv");

    expect(result.headers[0]).toBe("name");
  });

  it("normalizes Excel cell values to strings", async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Data");
    worksheet.addRow(["Name", "Number", "Date", "Boolean"]);
    worksheet.addRow(["Alice", 123, new Date("2024-01-15"), true]);

    const buffer = await workbook.xlsx.writeBuffer();

    const result = await parseSpreadsheet(buffer as unknown as Buffer, "types.xlsx");

    expect(result.rows[0]).toHaveLength(4);
    // All values should be converted to strings
    expect(typeof result.rows[0]?.[0]).toBe("string");
    expect(typeof result.rows[0]?.[1]).toBe("string");
  });

it("normalizes formula, hyperlink, and error cells without [object Object]", async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Data");
    worksheet.addRow(["Name", "Computed"]);
    worksheet.addRow(["Alice", { formula: "B2*2", result: 250 }]);
    worksheet.addRow(["Bob", { text: "site", hyperlink: "https://example.com" }]);
    worksheet.addRow(["Carol", { error: "#DIV/0!" }]);

    const buffer = await workbook.xlsx.writeBuffer();

    const result = await parseSpreadsheet(buffer as unknown as Buffer, "formulas.xlsx");

    expect(result.rows[0]).toContain("250");
    expect(result.rows[1]?.some((cell) => cell.includes("object Object"))).toBe(false);
    expect(result.rows[2]).toContain("#DIV/0!");
  });

  it("serializes Excel dates in a parseable format", async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Data");
    worksheet.addRow(["Name", "OrderDate"]);
    worksheet.addRow(["Alice", new Date("2024-01-15")]);

    const buffer = await workbook.xlsx.writeBuffer();

    const result = await parseSpreadsheet(buffer as unknown as Buffer, "dates.xlsx");

    expect(result.rows[0]?.[1]).toBe("2024-01-15");
  });

  it("throws error for empty file", async () => {
    const buffer = Buffer.alloc(0);

    await expect(parseSpreadsheet(buffer, "empty.csv")).rejects.toThrow();
  });

  it("throws error for invalid Excel file", async () => {
    const buffer = Buffer.from("not an excel file");

    await expect(parseSpreadsheet(buffer, "fake.xlsx")).rejects.toThrow();
  });

it("rejects CSV with header but no data rows", async () => {
    const csvContent = "header1,header2,header3";
    const buffer = Buffer.from(csvContent);

    await expect(parseSpreadsheet(buffer, "headers-only.csv")).rejects.toThrow();
  });
});

