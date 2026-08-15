// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataTable, createDataTableColumnHelper } from "@/components/shared/data-table";

interface DemoRow {
  id: string;
  name: string;
  status: string;
}

const rows: DemoRow[] = [
  { id: "1", name: "Website Redesign", status: "In progress" },
  { id: "2", name: "GBP Optimization", status: "Complete" },
  { id: "3", name: "SEO Sprint", status: "In progress" },
];

const helper = createDataTableColumnHelper<DemoRow>();
const columns = helper.columns([
  helper.accessor("name", { header: "Name" }),
  helper.accessor("status", { header: "Status" }),
]);

describe("DataTable", () => {
  it("renders every row's data", () => {
    render(<DataTable columns={columns} data={rows} />);
    expect(screen.getByText("Website Redesign")).toBeInTheDocument();
    expect(screen.getByText("GBP Optimization")).toBeInTheDocument();
    expect(screen.getByText("SEO Sprint")).toBeInTheDocument();
  });

  it("filters rows by the global search box", async () => {
    const user = userEvent.setup();
    render(<DataTable columns={columns} data={rows} />);
    await user.type(screen.getByRole("textbox", { name: "Search table" }), "SEO");
    expect(screen.getByText("SEO Sprint")).toBeInTheDocument();
    expect(screen.queryByText("Website Redesign")).not.toBeInTheDocument();
    expect(screen.queryByText("GBP Optimization")).not.toBeInTheDocument();
  });

  it("shows the empty state when the search matches nothing", async () => {
    const user = userEvent.setup();
    render(<DataTable columns={columns} data={rows} emptyTitle="No matches" />);
    await user.type(screen.getByRole("textbox", { name: "Search table" }), "nonexistent project");
    expect(screen.getByText("No matches")).toBeInTheDocument();
  });

  it("shows the loading skeleton instead of rows when loading", () => {
    render(<DataTable columns={columns} data={rows} loading />);
    expect(screen.queryByText("Website Redesign")).not.toBeInTheDocument();
  });

  it("sorts rows when a sortable column header is clicked", async () => {
    const user = userEvent.setup();
    render(<DataTable columns={columns} data={rows} />);
    await user.click(screen.getByRole("button", { name: /Name/ }));
    const cells = screen.getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[0].textContent);
    expect(cells).toEqual([...cells].sort((a, b) => (a ?? "").localeCompare(b ?? "")));
  });

  it("paginates when there are more rows than the page size", async () => {
    const user = userEvent.setup();
    const manyRows: DemoRow[] = Array.from({ length: 5 }, (_, i) => ({
      id: String(i),
      name: `Project ${i}`,
      status: "Active",
    }));
    render(<DataTable columns={columns} data={manyRows} pageSize={2} />);
    expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument();
    expect(screen.getByText("Project 0")).toBeInTheDocument();
    expect(screen.queryByText("Project 2")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText(/Page 2 of 3/)).toBeInTheDocument();
    expect(screen.getByText("Project 2")).toBeInTheDocument();
    expect(screen.queryByText("Project 0")).not.toBeInTheDocument();
  });
});
