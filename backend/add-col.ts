import { config } from "dotenv";
config();
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    await pool.query(
      'ALTER TABLE "EmailDelivery" ADD COLUMN IF NOT EXISTS "organizationId" UUID NOT NULL DEFAULT gen_random_uuid();',
    );
    console.log("organizationId column added to EmailDelivery.");
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await pool.end();
  }
}

main();
