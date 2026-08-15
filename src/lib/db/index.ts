export { db, isDatabaseConfigured } from "./client";
export { translatePrismaError, withDbErrorTranslation } from "./errors";
export { withTransaction } from "./transaction";
export type { TransactionClient } from "./transaction";
export { checkDatabaseHealth } from "./health";
export type { DatabaseHealthResult, DatabaseHealthStatus } from "./health";
