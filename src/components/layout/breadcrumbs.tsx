import { Fragment } from "react"
import Link from "next/link"
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

export interface BreadcrumbEntry {
  label: string
  /** Omit on the final (current-page) entry. */
  href?: string
}

/**
 * Collapses to an ellipsis when there are more than 4 entries, keeping
 * the first entry and the last two visible — a full trail gets unreadable
 * fast on deeply nested enterprise routes (e.g. Customer → Acme Co →
 * Projects → Website Redesign → Tasks → #142).
 */
export function Breadcrumbs({ items }: { items: BreadcrumbEntry[] }) {
  const collapsed = items.length > 4
  const visible: (BreadcrumbEntry | null)[] = collapsed
    ? [items[0], null, ...items.slice(-2)]
    : items

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {visible.map((item, index) => {
          const isLast = index === visible.length - 1
          return (
            <Fragment key={item ? `${item.label}-${index}` : `ellipsis-${index}`}>
              <BreadcrumbItem>
                {item === null ? (
                  <BreadcrumbEllipsis />
                ) : isLast || !item.href ? (
                  <BreadcrumbPage>{item.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link href={item.href}>{item.label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!isLast && <BreadcrumbSeparator />}
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
