import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveEcommerceDevScope } from "./ecommerce-shared";
import { ecommerceProductRepository, type EcommerceProductListFilters } from "@/server/repositories/ecommerce-product-repository";
import { ecommerceVariantRepository } from "@/server/repositories/ecommerce-variant-repository";
import { ecommerceCollectionRepository, ecommerceCollectionProductRepository } from "@/server/repositories/ecommerce-collection-repository";
import { ecommerceImportBatchRepository } from "@/server/repositories/ecommerce-import-batch-repository";
import { loadEcommerceStoreChecked } from "./ecommerce-engagement-service";
import { normalizeEcommerceHandle, InvalidEcommerceHandleError } from "@/lib/ecommerce/handle";
import { isHttpUrl } from "@/lib/website-dev/url";
import { canTransitionEcommerceProduct } from "@/lib/ecommerce/product-lifecycle";
import { parseEcommerceProductCsv, MAX_IMPORT_ROWS } from "@/lib/ecommerce/csv-import";
import { toMinorUnits } from "@/lib/utils/money";
import { assertNoSecretLikeContent, SuspectedSecretContentError } from "@/lib/security/secret-guard";
import { audit } from "@/lib/audit/service";
import { NotFoundError, ValidationError, ConflictError } from "@/lib/errors/app-error";
import type { EcommerceProduct, EcommerceVariant, EcommerceCollection, EcommerceProductStatus } from "@/generated/prisma/client";
import type { TransactionClient } from "@/lib/db/transaction";
import type { OffsetPaginatedResult, OffsetPaginationParams } from "@/lib/platform/pagination";

/**
 * E-Commerce Development catalog management (Build 33 — Roadmap Module
 * 27) — products, variants, collections, and CSV import. Reuses
 * `ecommerce_development.manage` for every structural mutation (no
 * separate `.catalog_manage` tier — the same reasoning Website Dev's
 * own single `.manage` tier already covers page/environment CRUD
 * without a narrower split). `ecommerce_development.read` for
 * listing/detail.
 */

function assertFieldsClean(fields: Record<string, string | null | undefined>): void {
  for (const [label, value] of Object.entries(fields)) {
    try {
      assertNoSecretLikeContent(value, label);
    } catch (error) {
      if (error instanceof SuspectedSecretContentError) throw new ValidationError(error.message);
      throw error;
    }
  }
}

function normalizeHandleOrThrow(input: string): string {
  try {
    return normalizeEcommerceHandle(input);
  } catch (error) {
    if (error instanceof InvalidEcommerceHandleError) throw new ValidationError(error.message);
    throw error;
  }
}

// --- Products -----------------------------------------------------------

const createProductSchema = z.object({
  storeId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  handle: z.string().trim().min(1).max(200).nullable().optional(),
  productType: z.string().trim().max(100).nullable().optional(),
  vendor: z.string().trim().max(100).nullable().optional(),
  requiredForLaunch: z.boolean().default(true),
  sortOrder: z.coerce.number().int().default(0),
  primaryImageUrl: z.string().trim().max(2048).nullable().optional(),
});

export async function createEcommerceProduct(rawInput: unknown): Promise<EcommerceProduct> {
  const input = parseOrThrow(createProductSchema, rawInput);
  // Codex Security Engineer finding ECOM-SEC-01/ECOM-SEC-02 — `primaryImageUrl`
  // is now both screened for credential-shaped content AND validated
  // http(s)-only (mirroring `storeUrl`'s own two-layer defense), never
  // persisted as an arbitrary scheme like `javascript:`.
  assertFieldsClean({ "Product title": input.title, "Product type": input.productType ?? null, Vendor: input.vendor ?? null, "Primary image URL": input.primaryImageUrl ?? null });
  if (input.primaryImageUrl && !isHttpUrl(input.primaryImageUrl)) throw new ValidationError("primaryImageUrl must use http:// or https://");
  const normalizedHandle = input.handle ? normalizeHandleOrThrow(input.handle) : null;
  const { context, tenantScope, organizationId } = await resolveEcommerceDevScope("ecommerce_development.manage");

  const product = await withTenantContext(tenantScope, async (tx) => {
    await loadEcommerceStoreChecked(input.storeId, organizationId, tx);
    if (normalizedHandle) {
      const existing = await ecommerceProductRepository.findByHandle(input.storeId, normalizedHandle, tx);
      if (existing) throw new ConflictError(`"${normalizedHandle}" is already tracked as a product handle on this store.`);
    }

    return ecommerceProductRepository.create(
      {
        id: generateId(),
        organizationId,
        storeId: input.storeId,
        title: input.title,
        handle: normalizedHandle,
        externalProductId: null,
        productType: input.productType ?? null,
        vendor: input.vendor ?? null,
        source: "MANUAL",
        requiredForLaunch: input.requiredForLaunch,
        sortOrder: input.sortOrder,
        primaryImageUrl: input.primaryImageUrl ?? null,
        importBatchId: null,
        createdByUserId: context.user!.id,
      },
      tx,
    );
  });

  await audit
    .recordSuccess({ action: "ecommerce.product_created", organizationId, resourceType: "ecommerce_product", resourceId: product.id, resourceName: product.title, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record ecommerce.product_created", error));
  return product;
}

const productIdSchema = z.object({ productId: z.string().uuid() });

async function loadEcommerceProductChecked(productId: string, organizationId: string, tx: TransactionClient): Promise<EcommerceProduct> {
  const product = await ecommerceProductRepository.findById(productId, tx);
  if (!product || product.organizationId !== organizationId) throw new NotFoundError("E-Commerce product");
  return product;
}

export async function getEcommerceProduct(rawInput: unknown): Promise<EcommerceProduct> {
  const input = parseOrThrow(productIdSchema, rawInput);
  const { tenantScope, organizationId } = await resolveEcommerceDevScope("ecommerce_development.read");
  return withTenantContext(tenantScope, (tx) => loadEcommerceProductChecked(input.productId, organizationId, tx));
}

const listProductsSchema = z.object({
  storeId: z.string().uuid(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(["PLANNED", "IN_PROGRESS", "QA", "READY_FOR_LAUNCH", "LIVE", "ARCHIVED"]).optional(),
  search: z.string().trim().max(200).optional(),
});

export async function listEcommerceProducts(rawInput: unknown): Promise<OffsetPaginatedResult<EcommerceProduct>> {
  const input = parseOrThrow(listProductsSchema, rawInput);
  const { tenantScope, organizationId } = await resolveEcommerceDevScope("ecommerce_development.read");
  const params: OffsetPaginationParams = { page: input.page, limit: input.limit };
  const filters: EcommerceProductListFilters = { status: input.status, search: input.search };
  return withTenantContext(tenantScope, async (tx) => {
    await loadEcommerceStoreChecked(input.storeId, organizationId, tx);
    return ecommerceProductRepository.listForStore(input.storeId, params, filters, tx);
  });
}

const transitionProductSchema = z.object({ productId: z.string().uuid(), status: z.enum(["PLANNED", "IN_PROGRESS", "QA", "READY_FOR_LAUNCH", "LIVE", "ARCHIVED"]) });

export async function transitionEcommerceProductStatus(rawInput: unknown): Promise<EcommerceProduct> {
  const input = parseOrThrow(transitionProductSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveEcommerceDevScope("ecommerce_development.manage");
  const product = await withTenantContext(tenantScope, async (tx) => {
    const existing = await loadEcommerceProductChecked(input.productId, organizationId, tx);
    if (!canTransitionEcommerceProduct(existing.status as EcommerceProductStatus, input.status)) throw new ValidationError(`Cannot move a ${existing.status} product to ${input.status}.`);
    const updated = await ecommerceProductRepository.transition(input.productId, existing.status, input.status, tx);
    if (!updated) throw new ConflictError("This product was just changed by someone else. Reload and try again.");
    return updated;
  });
  await audit
    .recordSuccess({ action: "ecommerce.product_status_changed", organizationId, resourceType: "ecommerce_product", resourceId: product.id, resourceName: product.title, metadata: { status: product.status }, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record ecommerce.product_status_changed", error));
  return product;
}

// --- Variants -----------------------------------------------------------

const createVariantSchema = z.object({
  productId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  sku: z.string().trim().max(100).nullable().optional(),
  option1Name: z.string().trim().max(60).nullable().optional(),
  option1Value: z.string().trim().max(120).nullable().optional(),
  option2Name: z.string().trim().max(60).nullable().optional(),
  option2Value: z.string().trim().max(120).nullable().optional(),
  option3Name: z.string().trim().max(60).nullable().optional(),
  option3Value: z.string().trim().max(120).nullable().optional(),
  priceMajor: z.number().nonnegative().nullable().optional(),
  compareAtPriceMajor: z.number().nonnegative().nullable().optional(),
});

/** Product/variant pricing (Build 33) — the STORE's own single `currency` field is the implied unit for every variant price; a price cannot be recorded until the store has a currency set. Distinct from Alpha Page Rankers' own Build 22/29 commercial service pricing — this is catalog/merchant data. */
export async function createEcommerceVariant(rawInput: unknown): Promise<EcommerceVariant> {
  const input = parseOrThrow(createVariantSchema, rawInput);
  // Codex Security Engineer finding ECOM-SEC-01 — every persisted
  // free-text field is screened, not just `title`; a SKU or option
  // name/value is exactly the kind of field a staff member might
  // mistakenly paste a credential into.
  assertFieldsClean({
    "Variant title": input.title,
    SKU: input.sku ?? null,
    "Option 1 name": input.option1Name ?? null,
    "Option 1 value": input.option1Value ?? null,
    "Option 2 name": input.option2Name ?? null,
    "Option 2 value": input.option2Value ?? null,
    "Option 3 name": input.option3Name ?? null,
    "Option 3 value": input.option3Value ?? null,
  });
  const { context, tenantScope, organizationId } = await resolveEcommerceDevScope("ecommerce_development.manage");

  const variant = await withTenantContext(tenantScope, async (tx) => {
    const product = await loadEcommerceProductChecked(input.productId, organizationId, tx);
    const store = await loadEcommerceStoreChecked(product.storeId, organizationId, tx);

    let priceMinorUnits: number | null = null;
    let compareAtPriceMinorUnits: number | null = null;
    if (input.priceMajor != null || input.compareAtPriceMajor != null) {
      if (!store.currency) throw new ValidationError("This store has no currency configured yet — set a store currency before recording a variant price.");
      if (input.priceMajor != null) priceMinorUnits = toMinorUnits(input.priceMajor, store.currency);
      if (input.compareAtPriceMajor != null) compareAtPriceMinorUnits = toMinorUnits(input.compareAtPriceMajor, store.currency);
    }

    if (input.sku) {
      const existing = await ecommerceVariantRepository.findBySku(product.storeId, input.sku, tx);
      if (existing) throw new ConflictError(`SKU "${input.sku}" is already tracked on this store.`);
    }

    return ecommerceVariantRepository.create(
      {
        id: generateId(),
        organizationId,
        productId: input.productId,
        storeId: product.storeId,
        title: input.title,
        externalVariantId: null,
        sku: input.sku ?? null,
        option1Name: input.option1Name ?? null,
        option1Value: input.option1Value ?? null,
        option2Name: input.option2Name ?? null,
        option2Value: input.option2Value ?? null,
        option3Name: input.option3Name ?? null,
        option3Value: input.option3Value ?? null,
        priceMinorUnits,
        compareAtPriceMinorUnits,
        createdByUserId: context.user!.id,
      },
      tx,
    );
  });

  await audit
    .recordSuccess({ action: "ecommerce.variant_created", organizationId, resourceType: "ecommerce_variant", resourceId: variant.id, resourceName: variant.title, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record ecommerce.variant_created", error));
  return variant;
}

const listVariantsSchema = z.object({ productId: z.string().uuid() });

export async function listEcommerceVariants(rawInput: unknown): Promise<EcommerceVariant[]> {
  const input = parseOrThrow(listVariantsSchema, rawInput);
  const { tenantScope, organizationId } = await resolveEcommerceDevScope("ecommerce_development.read");
  return withTenantContext(tenantScope, async (tx) => {
    await loadEcommerceProductChecked(input.productId, organizationId, tx);
    return ecommerceVariantRepository.listForProduct(input.productId, tx);
  });
}

// --- Collections ----------------------------------------------------------

const createCollectionSchema = z.object({
  storeId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  handle: z.string().trim().min(1).max(200).nullable().optional(),
});

export async function createEcommerceCollection(rawInput: unknown): Promise<EcommerceCollection> {
  const input = parseOrThrow(createCollectionSchema, rawInput);
  assertFieldsClean({ "Collection title": input.title });
  const normalizedHandle = input.handle ? normalizeHandleOrThrow(input.handle) : null;
  const { context, tenantScope, organizationId } = await resolveEcommerceDevScope("ecommerce_development.manage");

  const collection = await withTenantContext(tenantScope, async (tx) => {
    await loadEcommerceStoreChecked(input.storeId, organizationId, tx);
    if (normalizedHandle) {
      const existing = await ecommerceCollectionRepository.findByHandle(input.storeId, normalizedHandle, tx);
      if (existing) throw new ConflictError(`"${normalizedHandle}" is already tracked as a collection handle on this store.`);
    }
    return ecommerceCollectionRepository.create({ id: generateId(), organizationId, storeId: input.storeId, title: input.title, handle: normalizedHandle, createdByUserId: context.user!.id }, tx);
  });

  await audit
    .recordSuccess({ action: "ecommerce.collection_created", organizationId, resourceType: "ecommerce_collection", resourceId: collection.id, resourceName: collection.title, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record ecommerce.collection_created", error));
  return collection;
}

const listCollectionsSchema = z.object({ storeId: z.string().uuid() });

export async function listEcommerceCollections(rawInput: unknown): Promise<EcommerceCollection[]> {
  const input = parseOrThrow(listCollectionsSchema, rawInput);
  const { tenantScope, organizationId } = await resolveEcommerceDevScope("ecommerce_development.read");
  return withTenantContext(tenantScope, async (tx) => {
    await loadEcommerceStoreChecked(input.storeId, organizationId, tx);
    return ecommerceCollectionRepository.listForStore(input.storeId, tx);
  });
}

const addProductToCollectionSchema = z.object({ collectionId: z.string().uuid(), productId: z.string().uuid(), sortOrder: z.coerce.number().int().default(0) });

/** Structural same-store pre-check (app layer) alongside the DB trigger's own equivalent — a product from Store A can never be added to a collection belonging to Store B, even within the same organization. */
export async function addEcommerceProductToCollection(rawInput: unknown): Promise<void> {
  const input = parseOrThrow(addProductToCollectionSchema, rawInput);
  const { tenantScope, organizationId } = await resolveEcommerceDevScope("ecommerce_development.manage");

  await withTenantContext(tenantScope, async (tx) => {
    const collection = await ecommerceCollectionRepository.findById(input.collectionId, tx);
    if (!collection || collection.organizationId !== organizationId) throw new NotFoundError("E-Commerce collection");
    const product = await loadEcommerceProductChecked(input.productId, organizationId, tx);
    if (product.storeId !== collection.storeId) throw new ValidationError("This product belongs to a different store than this collection.");

    const exists = await ecommerceCollectionProductRepository.exists(input.collectionId, input.productId, tx);
    if (exists) throw new ConflictError("This product is already in this collection.");

    await ecommerceCollectionProductRepository.create({ id: generateId(), organizationId, collectionId: input.collectionId, productId: input.productId, sortOrder: input.sortOrder }, tx);
  });
}

// --- CSV import -----------------------------------------------------------

const importCsvSchema = z.object({
  storeId: z.string().uuid(),
  fileContent: z.string().max(5_000_000),
});

export interface EcommerceCatalogImportResult {
  totalRowCount: number;
  importedRowCount: number;
  skippedRowCount: number;
  skippedReasons: { rowNumber: number; reason: string }[];
}

/**
 * Manual CSV catalog import — one row creates one PRODUCT (this first
 * pass deliberately does not attempt a variant-matrix CSV format; see
 * `src/lib/ecommerce/csv-import.ts`'s own doc comment). Applies Build
 * 30's own hard-learned FK-ordering lesson from the start: the
 * `EcommerceImportBatch` parent row is created BEFORE any product row
 * references it, in the same transaction.
 *
 * Codex Security/Performance Engineer findings (Build 33 review), all
 * fixed here:
 *   - ECOM-SEC-05: the row-count limit is checked from a cheap line
 *     count BEFORE the full field-parsing pass runs, not after.
 *   - ECOM-SEC-01: every CSV-derived free-text field (title/productType/
 *     vendor/sku) is screened for credential-shaped content — a row
 *     tripping the guard is skipped with a reason, never silently
 *     imported, and never aborts the whole batch.
 *   - ECOM-SEC-03/PERF-ECOM-05: the existing-handle dedup query is now
 *     scoped to exactly the incoming file's own normalized handles
 *     (`handle: { in: [...] }`, at most `MAX_IMPORT_ROWS`) — exact AND
 *     bounded, replacing the previous `take: 20_000` blind prefetch that
 *     could silently miss handles beyond that cap on a very large store.
 *   - ECOM-SEC-06: a row's own `status` column is honored (an explicit
 *     staff-provided fact, not a fabricated one) instead of always
 *     defaulting to PLANNED; a row with a `price` but no `sku` is
 *     rejected as skipped (a price has nowhere to persist without a
 *     variant) rather than silently discarding the price while still
 *     counting the row as imported.
 *   - PERF-ECOM-01: rows are inserted via two `createMany()` batch
 *     writes (products, then variants) instead of up to 1,000 serial
 *     single-row `create()` calls — every product id is pre-generated in
 *     application code, so no round trip is needed to learn a product's
 *     own id before creating its optional default variant.
 */
export async function importEcommerceProductCsv(rawInput: unknown): Promise<EcommerceCatalogImportResult> {
  const input = parseOrThrow(importCsvSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveEcommerceDevScope("ecommerce_development.manage");

  // Cheap line count BEFORE the full parser's per-row field-parsing pass
  // — an over-limit file is rejected without doing that work at all.
  const lineCount = input.fileContent.split(/\r\n|\r|\n/).filter((line) => line.trim().length > 0).length;
  if (lineCount - 1 > MAX_IMPORT_ROWS) throw new ValidationError(`Import is limited to ${MAX_IMPORT_ROWS} rows per file.`);

  const parsed = parseEcommerceProductCsv(input.fileContent);
  if (parsed.totalDataRowCount > MAX_IMPORT_ROWS) throw new ValidationError(`Import is limited to ${MAX_IMPORT_ROWS} rows per file.`);

  const { batch, skippedReasons } = await withTenantContext(tenantScope, async (tx) => {
    const store = await loadEcommerceStoreChecked(input.storeId, organizationId, tx);

    const skippedReasons: { rowNumber: number; reason: string }[] = parsed.rejected.map((r) => ({ rowNumber: r.rowNumber, reason: r.reason }));
    const toInsert: { row: (typeof parsed.rows)[number]; normalizedHandle: string | null; priceMinorUnits: number | null }[] = [];
    const seenHandles = new Set<string>();
    const seenSkus = new Set<string>();

    // Normalize every incoming handle up front, then check existence
    // against ONLY those specific handles — exact (no cap-related blind
    // spot) and bounded to at most MAX_IMPORT_ROWS handles, unlike the
    // previous whole-store prefetch.
    const incomingNormalizedHandles = new Set<string>();
    for (const row of parsed.rows) {
      if (!row.handle) continue;
      try {
        incomingNormalizedHandles.add(normalizeEcommerceHandle(row.handle));
      } catch {
        // Invalid handles are rejected per-row below; ignore here.
      }
    }
    const existingHandleRows =
      incomingNormalizedHandles.size > 0 ? await tx.ecommerceProduct.findMany({ where: { storeId: input.storeId, handle: { in: [...incomingNormalizedHandles] } }, select: { handle: true } }) : [];
    const existingHandles = new Set(existingHandleRows.map((p) => p.handle).filter((h): h is string => h !== null));

    // Same exact/bounded treatment for SKUs — a priced+SKU'd row creates
    // a default variant, and `ecommerce_variants_store_id_sku_key` is a
    // real per-store uniqueness constraint.
    const incomingSkus = new Set(parsed.rows.map((r) => r.sku).filter((s): s is string => s !== null));
    const existingVariantRows = incomingSkus.size > 0 ? await tx.ecommerceVariant.findMany({ where: { storeId: input.storeId, sku: { in: [...incomingSkus] } }, select: { sku: true } }) : [];
    const existingSkus = new Set(existingVariantRows.map((v) => v.sku).filter((s): s is string => s !== null));

    for (const row of parsed.rows) {
      try {
        assertFieldsClean({ "CSV title": row.title, "CSV productType": row.productType, "CSV vendor": row.vendor, "CSV sku": row.sku });
      } catch (error) {
        if (error instanceof ValidationError) {
          skippedReasons.push({ rowNumber: row.rowNumber, reason: error.message });
          continue;
        }
        throw error;
      }

      let normalizedHandle: string | null = null;
      if (row.handle) {
        try {
          normalizedHandle = normalizeEcommerceHandle(row.handle);
        } catch {
          skippedReasons.push({ rowNumber: row.rowNumber, reason: `handle "${row.handle}" is not a valid handle` });
          continue;
        }
        if (existingHandles.has(normalizedHandle) || seenHandles.has(normalizedHandle)) {
          skippedReasons.push({ rowNumber: row.rowNumber, reason: `handle "${normalizedHandle}" already exists on this store or is duplicated within this file` });
          continue;
        }
        seenHandles.add(normalizedHandle);
      }

      let priceMinorUnits: number | null = null;
      if (row.price) {
        if (!row.sku) {
          // A price with no SKU has nowhere to persist (a variant
          // requires a SKU-scoped identity in this domain) — reject
          // rather than silently discarding the price while still
          // reporting the row as imported (ECOM-SEC-06).
          skippedReasons.push({ rowNumber: row.rowNumber, reason: "row has a price but no sku — a variant cannot be created without one" });
          continue;
        }
        if (!store.currency) {
          skippedReasons.push({ rowNumber: row.rowNumber, reason: "row has a price but this store has no currency configured yet" });
          continue;
        }
        priceMinorUnits = toMinorUnits(Number.parseFloat(row.price), store.currency);
      }
      if (row.sku) {
        if (existingSkus.has(row.sku) || seenSkus.has(row.sku)) {
          skippedReasons.push({ rowNumber: row.rowNumber, reason: `sku "${row.sku}" already exists on this store or is duplicated within this file` });
          continue;
        }
        seenSkus.add(row.sku);
      }

      toInsert.push({ row, normalizedHandle, priceMinorUnits });
    }

    // The batch parent is created BEFORE any product row references it.
    const batch = await ecommerceImportBatchRepository.create(
      { id: generateId(), organizationId, storeId: input.storeId, importedByUserId: context.user!.id, totalRowCount: parsed.totalDataRowCount, importedRowCount: toInsert.length, skippedRowCount: parsed.totalDataRowCount - toInsert.length },
      tx,
    );

    const productRows: { id: string; organizationId: string; storeId: string; title: string; handle: string | null; externalProductId: null; productType: string | null; vendor: string | null; source: "IMPORT"; status: EcommerceProductStatus; requiredForLaunch: boolean; sortOrder: number; primaryImageUrl: null; importBatchId: string; createdByUserId: string }[] = [];
    const variantRows: { id: string; organizationId: string; productId: string; storeId: string; title: string; externalVariantId: null; sku: string; option1Name: null; option1Value: null; option2Name: null; option2Value: null; option3Name: null; option3Value: null; priceMinorUnits: number; compareAtPriceMinorUnits: null; createdByUserId: string }[] = [];

    for (const { row, normalizedHandle, priceMinorUnits } of toInsert) {
      const productId = generateId();
      productRows.push({
        id: productId,
        organizationId,
        storeId: input.storeId,
        title: row.title,
        handle: normalizedHandle,
        externalProductId: null,
        productType: row.productType,
        vendor: row.vendor,
        source: "IMPORT",
        status: row.status,
        requiredForLaunch: row.requiredForLaunch,
        sortOrder: 0,
        primaryImageUrl: null,
        importBatchId: batch.id,
        createdByUserId: context.user!.id,
      });
      if (priceMinorUnits !== null && row.sku) {
        // A row with both a price and a SKU also gets one default
        // variant carrying that price/SKU — otherwise the price/SKU the
        // row provided would be silently discarded.
        variantRows.push({
          id: generateId(),
          organizationId,
          productId,
          storeId: input.storeId,
          title: "Default",
          externalVariantId: null,
          sku: row.sku,
          option1Name: null,
          option1Value: null,
          option2Name: null,
          option2Value: null,
          option3Name: null,
          option3Value: null,
          priceMinorUnits,
          compareAtPriceMinorUnits: null,
          createdByUserId: context.user!.id,
        });
      }
    }

    if (productRows.length > 0) await tx.ecommerceProduct.createMany({ data: productRows });
    if (variantRows.length > 0) await tx.ecommerceVariant.createMany({ data: variantRows });

    return { batch, skippedReasons };
  });

  await audit
    .recordSuccess({
      action: "ecommerce.catalog_import_recorded",
      organizationId,
      resourceType: "ecommerce_import_batch",
      resourceId: batch.id,
      resourceName: `Import — ${batch.importedRowCount}/${batch.totalRowCount} rows`,
      metadata: { totalRowCount: batch.totalRowCount, importedRowCount: batch.importedRowCount, skippedRowCount: batch.skippedRowCount },
      knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined,
    })
    .catch((error) => console.error("[audit] failed to record ecommerce.catalog_import_recorded", error));

  return { totalRowCount: batch.totalRowCount, importedRowCount: batch.importedRowCount, skippedRowCount: batch.skippedRowCount, skippedReasons };
}

const listImportBatchesSchema = z.object({ storeId: z.string().uuid(), limit: z.coerce.number().int().min(1).max(200).default(50) });

export async function listEcommerceImportBatches(rawInput: unknown) {
  const input = parseOrThrow(listImportBatchesSchema, rawInput);
  const { tenantScope, organizationId } = await resolveEcommerceDevScope("ecommerce_development.read");
  return withTenantContext(tenantScope, async (tx) => {
    await loadEcommerceStoreChecked(input.storeId, organizationId, tx);
    return ecommerceImportBatchRepository.listForStore(input.storeId, input.limit, tx);
  });
}
