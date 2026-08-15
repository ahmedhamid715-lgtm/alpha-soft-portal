"use client"

import * as React from "react"
import {
  columnFilteringFeature,
  createColumnHelper,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_includesString,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_text,
  tableFeatures,
  useTable,
  type ColumnDef,
  type RowData,
} from "@tanstack/react-table"
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from "@/components/ui/pagination"
import { TableSkeleton } from "./loading-patterns"
import { EmptyState } from "./empty-state"

/**
 * The one feature set / column-helper pair every DataTable instance
 * shares. TanStack Table v9 types columns against a concrete `features`
 * object (`typeof dataTableFeatures`), so a column built anywhere in the
 * app for use with DataTable must come from `createDataTableColumnHelper`
 * — not a bare `createColumnHelper` call — or the types won't line up.
 * See docs/architecture/design-system.md "Data table" for the full
 * rationale (this is TanStack Table v9's explicit-feature-registration
 * model, not an Alpha OS invention).
 */
export const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text },
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  filterFns: { includesString: filterFn_includesString },
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
})

export function createDataTableColumnHelper<TData extends RowData>() {
  return createColumnHelper<typeof dataTableFeatures, TData>()
}

export type DataTableColumnDef<TData extends RowData, TValue = unknown> = ColumnDef<
  typeof dataTableFeatures,
  TData,
  TValue
>

export interface DataTableProps<TData extends RowData> {
  // `any` here, not `unknown` — `columns` is built via
  // `createDataTableColumnHelper<TData>().columns([...])`, which preserves
  // each accessor's own specific value type (see the TanStack Table v9
  // "typescript" skill's "erasing accessor value inference" pitfall). A
  // narrower shared element type would force every column to the same
  // TValue and reject that heterogeneous, correctly-inferred array.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: DataTableColumnDef<TData, any>[]
  data: TData[]
  loading?: boolean
  searchPlaceholder?: string
  emptyTitle?: string
  emptyDescription?: string
  pageSize?: number
  className?: string
}

/**
 * Dense enterprise table: sortable columns (click a header), a global
 * search box, and pagination — the three things every list view in Admin/
 * CRM/Projects/Support/Finance needs, built once instead of per-module.
 * Sorting/filtering/pagination state is owned internally by the table
 * instance (see the TanStack Table v9 "table-state" ownership model) —
 * pass `data`/`columns` in, this component owns everything else.
 */
export function DataTable<TData extends RowData>({
  columns,
  data,
  loading,
  searchPlaceholder = "Search…",
  emptyTitle = "No results",
  emptyDescription = "Try adjusting your search or filters.",
  pageSize = 10,
  className,
}: DataTableProps<TData>) {
  const table = useTable(
    {
      features: dataTableFeatures,
      columns,
      data,
      globalFilterFn: "includesString",
      initialState: { pagination: { pageIndex: 0, pageSize } },
    },
    (state) => ({
      sorting: state.sorting,
      globalFilter: state.globalFilter,
      pagination: state.pagination,
    })
  )

  const rows = table.getRowModel().rows
  const { pageIndex, pageSize: currentPageSize } = table.state.pagination
  const pageCount = table.getPageCount()

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          value={table.state.globalFilter ?? ""}
          onChange={(event) => table.setGlobalFilter(event.target.value)}
          placeholder={searchPlaceholder}
          className="pl-8"
          aria-label="Search table"
        />
      </div>

      {loading ? (
        <TableSkeleton columns={columns.length} />
      ) : rows.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const canSort = header.column.getCanSort()
                    const sortDirection = header.column.getIsSorted()
                    return (
                      <TableHead key={header.id}>
                        {header.isPlaceholder ? null : canSort ? (
                          <button
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                            className="inline-flex items-center gap-1.5 font-medium hover:text-foreground"
                          >
                            <table.FlexRender header={header} />
                            {sortDirection === "asc" ? (
                              <ArrowUp className="size-3.5" aria-hidden="true" />
                            ) : sortDirection === "desc" ? (
                              <ArrowDown className="size-3.5" aria-hidden="true" />
                            ) : (
                              <ArrowUpDown className="size-3.5 text-muted-foreground/50" aria-hidden="true" />
                            )}
                          </button>
                        ) : (
                          <table.FlexRender header={header} />
                        )}
                      </TableHead>
                    )
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getAllCells().map((cell) => (
                    <TableCell key={cell.id}>
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {!loading && rows.length > 0 && pageCount > 1 ? (
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            Page {pageIndex + 1} of {pageCount} · {table.getRowCount()} rows · {currentPageSize}/page
          </p>
          <Pagination className="mx-0 w-auto">
            <PaginationContent>
              <PaginationItem>
                <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
                  Previous
                </Button>
              </PaginationItem>
              <PaginationItem>
                <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
                  Next
                </Button>
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      ) : null}
    </div>
  )
}
