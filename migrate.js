import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import { pool } from "../database/pool.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const migrationsPath = path.join(
    __dirname,
    "..",
    "database",
    "migrations"
);

async function createMigrationsTable() {

    await pool.query(`
        CREATE TABLE IF NOT EXISTS migrations (

            id SERIAL PRIMARY KEY,

            filename VARCHAR(255) NOT NULL UNIQUE,

            executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP

        );
    `);

}

async function getExecutedMigrations() {

    const result = await pool.query(`
        SELECT filename
        FROM migrations;
    `);

    return result.rows.map(row => row.filename);

}

async function executeMigration(fileName) {

    const client = await pool.connect();

    try {

        const filePath = path.join(migrationsPath, fileName);

        const sql = await fs.readFile(filePath, "utf8");

        if (!sql.trim()) {
            throw new Error(`${fileName} está vacío.`);
        }

        await client.query("BEGIN");

        await client.query(sql);

        await client.query(
            `
            INSERT INTO migrations(filename)
            VALUES($1);
            `,
            [fileName]
        );

        await client.query("COMMIT");

    } catch (error) {

        await client.query("ROLLBACK");

        throw error;

    } finally {

        client.release();

    }

}

async function migrate() {

    try {

        console.log("\nIniciando migraciones...\n");

        await createMigrationsTable();

        const executed = await getExecutedMigrations();

        const files = (await fs.readdir(migrationsPath))
            .filter(file => file.endsWith(".sql"))
            .sort();

        if (files.length === 0) {

            console.log("No existen migraciones para ejecutar.");

            return;

        }

        let executedCount = 0;
        let skippedCount = 0;

        for (const file of files) {

            if (executed.includes(file)) {

                console.log(`⏩ ${file} (omitida)`);

                skippedCount++;

                continue;

            }

            console.log(`▶ Ejecutando ${file}`);

            await executeMigration(file);

            console.log(`✔ ${file}`);

            executedCount++;

        }

        console.log("\n==================================");

        console.log("Resumen");

        console.log("==================================");

        console.log(`Ejecutados : ${executedCount}`);

        console.log(`Omitidos   : ${skippedCount}`);

        console.log("==================================");

    } catch (error) {

        console.error("\nError durante las migraciones:\n");

        console.error(error);

    } finally {

        await pool.end();

    }

}

migrate();