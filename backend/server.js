const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const express = require("express");
const multer = require("multer");
const XLSX = require("xlsx");
const oracledb = require("oracledb");
const app = express();
const port = process.env.PORT || 3001;
const allowedExtensions = new Set([".xlsx", ".xls", ".csv"]);
const tableOwner = "PNRDB_DEV";
const tableName = "01_Temp_members_master_data";
const masterTables = {
  districts: { table: "districts", sourceColumn: "DISTRIC_ID" },
  provinces: { table: "provinces", sourceColumn: "PROVINCE_ID" },
  gnDivisions: { table: "gn_divisions", sourceColumn: "GN_DIVISION_ID" },
  banks: { table: "banks", sourceColumn: "BANK_ID" },
  branches: { table: "branches", sourceColumn: "BRANCH_ID" },
  member_categories: { table: "member_categories", sourceColumn: "MEMBER_CATEGORY_ID" },
  races: { table: "races", sourceColumn: "RACE_ID" },
  religions: { table: "religions", sourceColumn: "RELIGION_ID" },
  nationalities: { table: "nationalities", sourceColumn: "NATIONALITY" },
  electorate_divisions: { table: "electorate_divisions", sourceColumn: "ELECTORATE_DIVISION_ID" },
  ranks: { table: "ranks", sourceColumn: "RANK" },
  divisional_secretariats: { table: "divisional_secretariats", sourceColumn: "DIVISIONAL_SECRETARIAT" },
  genders: { table: "genders", sourceColumn: "GENDER_ID" },
  member_categories: { table: "member_categories", sourceColumn: "MEMBER_CATEGORY_ID" },
};
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (!allowedExtensions.has(extension)) {
      callback(new Error("Only .xlsx, .xls, and .csv files are supported."));
      return;
    }
    callback(null, true);
  },
});

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function getDatabaseConfig() {
  const { DB_USER, DB_PASSWORD, DB_CONNECT_STRING, DB_HOST, DB_PORT, DB_SERVICE_NAME } = process.env;
  const connectString = DB_CONNECT_STRING
    || (DB_HOST && DB_PORT && DB_SERVICE_NAME
      ? `${DB_HOST}:${DB_PORT}/${DB_SERVICE_NAME}`
      : "");

  if (!DB_USER || !DB_PASSWORD || !connectString) {
    throw httpError(503, "Database connection is not configured on the server.");
  }

  return { user: DB_USER, password: DB_PASSWORD, connectString };
}

function quoteIdentifier(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function checkMasterDataIds(type) {
  const master = masterTables[type];
  if (!master) {
    throw httpError(400, "Choose a supported master data table.");
  }
  const { table: masterTable, sourceColumn } = master;
  const isNameMatch = type === "divisional_secretariats"||type === "ranks" || type === "gn_divisions" || type === "electorate_divisions" || type === "genders";
  const masterMatchColumn = isNameMatch ? "name" : "old_id";

  const config = getDatabaseConfig();
  let connection;
  try {
    connection = await oracledb.getConnection(config);
    for (const [targetTable, column] of [
      [tableName, sourceColumn],
      [masterTable, masterMatchColumn],
    ]) {
      const columnResult = await connection.execute(
        `SELECT column_name
           FROM all_tab_columns
          WHERE owner = :owner
            AND table_name = :tableName
            AND column_name = :columnName`,
        { owner: tableOwner, tableName: targetTable, columnName: column },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      if (columnResult.rows.length === 0) {
        throw httpError(
          500,
          `Column ${column} was not found in ${tableOwner}."${targetTable}".`,
        );
      }
    }

    const qualifiedTempTable = `${quoteIdentifier(tableOwner)}.${quoteIdentifier(tableName)}`;
    const qualifiedMasterTable = `${quoteIdentifier(tableOwner)}.${quoteIdentifier(masterTable)}`;
    const joinCondition = isNameMatch
      ? `UPPER(TRIM(src.${quoteIdentifier(sourceColumn)})) = UPPER(TRIM(master.${quoteIdentifier(masterMatchColumn)}))`
      : `src.${quoteIdentifier(sourceColumn)} = master.${quoteIdentifier(masterMatchColumn)}`;
    const matchedColumn = isNameMatch
      ? `, master.${quoteIdentifier(masterMatchColumn)} AS "MATCHED_NAME"`
      : "";
    const result = await connection.execute(
      `SELECT src.${quoteIdentifier(sourceColumn)} AS "ID",
              CASE
                WHEN master.${quoteIdentifier(masterMatchColumn)} IS NOT NULL THEN 'MATCHED'
                ELSE 'UNMATCHED'
              END AS "STATUS"${matchedColumn}
         FROM (
           SELECT DISTINCT ${quoteIdentifier(sourceColumn)}
             FROM ${qualifiedTempTable}
            WHERE ${quoteIdentifier(sourceColumn)} IS NOT NULL
         ) src
         LEFT JOIN ${qualifiedMasterTable} master
           ON ${joinCondition}
        ORDER BY TO_CHAR(src.${quoteIdentifier(sourceColumn)})`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    const rows = result.rows.map((row) => ({
      id: row.ID,
      status: row.STATUS,
      ...(isNameMatch ? { matchedName: row.MATCHED_NAME } : {}),
    }));
    return {
      table: masterTable,
      sourceColumn,
      total: rows.length,
      matched: rows.filter((row) => row.status.startsWith("MATCHED")).length,
      unmatched: rows.filter((row) => row.status.startsWith("UNMATCHED")).length,
      rows,
    };
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (closeError) {
        console.error("Database connection close failed:", closeError.message);
      }
    }
  }
}

async function upsertTableData(rows) {
  const config = getDatabaseConfig();
  console.log(`Connecting to Oracle database as user "${config.user}" at "${config.connectString}".`);
  let connection;

  try {
    connection = await oracledb.getConnection(config);
    const columnsResult = await connection.execute(
      `SELECT column_name, data_type
         FROM all_tab_columns
        WHERE owner = :owner
          AND table_name = :tableName
        ORDER BY column_id`,
      { owner: tableOwner, tableName },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const columnMetadata = new Map(
      columnsResult.rows.map((row) => [
        row.COLUMN_NAME,
        row.DATA_TYPE.toUpperCase().replace(/\(\d+\)/g, ""),
      ]),

      console.log(`Retrieved ${columnsResult.rows.length} columns from table "${tableOwner}.${tableName}".`)
    );
    const columns = [...columnMetadata.keys()];
    if (columns.length === 0) {
      throw httpError(500, "The destination table was not found or is not accessible.");
    }

    const columnsByName = new Map(columns.map((column) => [column.toUpperCase(), column]));
    const headers = Object.keys(rows[0]);
    console.log(headers)
    const insertColumns = headers.map((header) => {
      const column = columnsByName.get(header.trim().toUpperCase());
      if (!column) {
        throw httpError(400, `The uploaded file contains an unknown column: ${header}`);
      }
      console.log(column)
      return column;
    });
    if (new Set(insertColumns).size !== insertColumns.length) {
      throw httpError(400, "The uploaded file contains duplicate column names.");
    }
    const oldIdIndex = insertColumns.findIndex((column) => column.toUpperCase() === "OLD_ID");
    if (oldIdIndex === -1) {
      throw httpError(400, 'The uploaded file must contain the "OLD_ID" column.');
    }

    const insertData = insertColumns.map((column, index) => {
      const oracleType = columnMetadata.get(column);
      const values = rows.map((row) => row[headers[index]]);
      const emptyToNull = (value) => value === "" || value == null;

      if (["VARCHAR2", "CHAR", "NVARCHAR2", "NCHAR"].includes(oracleType)) {
        const type = ["NVARCHAR2", "NCHAR"].includes(oracleType)
          ? oracledb.DB_TYPE_NVARCHAR
          : oracledb.DB_TYPE_VARCHAR;
        const normalized = values.map((value) => {
          if (emptyToNull(value)) return null;
          if (value instanceof Date) return value.toISOString().slice(0, 10);
          return String(value);
        });
        const maxSize = normalized.reduce(
          (maximum, value) => Math.max(maximum, value ? Buffer.byteLength(value, "utf8") : 0),
          1,
        );
        return { type, maxSize, values: normalized };
      }
      if (["NUMBER", "FLOAT", "BINARY_FLOAT", "BINARY_DOUBLE"].includes(oracleType)) {
        const normalized = values.map((value) => {
          if (emptyToNull(value) || (typeof value === "string" && value.trim() === "")) return null;
          const number = typeof value === "number" ? value : Number(value);
          if (!Number.isFinite(number)) {
            if (column.toUpperCase() === "GN_DIVISION_ID") return null;
            throw httpError(400, `Column "${column}" contains a value that is not numeric.`);
          }
          return number;
        });
        return { type: oracledb.DB_TYPE_NUMBER, values: normalized };
      }
      if (["DATE", "TIMESTAMP", "TIMESTAMP WITH TIME ZONE", "TIMESTAMP WITH LOCAL TIME ZONE"].includes(oracleType)) {
        const type = oracleType === "DATE"
          ? oracledb.DB_TYPE_DATE
          : oracleType === "TIMESTAMP WITH TIME ZONE"
            ? oracledb.DB_TYPE_TIMESTAMP_TZ
            : oracleType === "TIMESTAMP WITH LOCAL TIME ZONE"
              ? oracledb.DB_TYPE_TIMESTAMP_LTZ
              : oracledb.DB_TYPE_TIMESTAMP;
        const normalized = values.map((value) => {
          if (emptyToNull(value)) return null;
          const date = value instanceof Date ? value : new Date(value);
          if (Number.isNaN(date.getTime())) {
            throw httpError(400, `Column "${column}" contains a value that is not a valid date.`);
          }
          return date;
        });
        return { type, values: normalized };
      }
      if (["CLOB", "NCLOB"].includes(oracleType)) {
        const normalized = values.map((value) => (emptyToNull(value) ? null : String(value)));
        return {
          type: oracleType === "NCLOB" ? oracledb.DB_TYPE_NCLOB : oracledb.DB_TYPE_CLOB,
          values: normalized,
        };
      }
      throw httpError(400, `The destination column "${column}" uses an unsupported data type.`);
    });

    const oldIds = insertData[oldIdIndex].values.map((value) =>
      typeof value === "string" ? value.trim() : value,
    );
    const seenOldIds = new Set();
    oldIds.forEach((oldId, index) => {
      if (oldId == null || (typeof oldId === "string" && oldId === "")) {
        throw httpError(400, `Row ${index + 2} is missing OLD_ID.`);
      }
      const normalizedOldId = String(oldId);
      if (seenOldIds.has(normalizedOldId)) {
        throw httpError(400, `The uploaded file contains duplicate OLD_ID "${normalizedOldId}".`);
      }
      seenOldIds.add(normalizedOldId);
    });
    insertData[oldIdIndex].values = oldIds;

    const qualifiedTable = `${quoteIdentifier(tableOwner)}.${quoteIdentifier(tableName)}`;
    const bindPlaceholders = insertColumns.map((_, index) => `:${index + 1}`);
    const quotedColumns = insertColumns.map(quoteIdentifier).join(", ");
    const sourceColumns = insertColumns
      .map((column, index) => `${bindPlaceholders[index]} ${quoteIdentifier(column)}`)
      .join(", ");
    const updateColumns = insertColumns.filter((_, index) => index !== oldIdIndex);
    const updateClause = updateColumns.length > 0
      ? ` WHEN MATCHED THEN UPDATE SET ${updateColumns
        .map((column) => `target.${quoteIdentifier(column)} = source.${quoteIdentifier(column)}`)
        .join(", ")}`
      : "";
    const upsertSql = `MERGE INTO ${qualifiedTable} target
      USING (SELECT ${sourceColumns} FROM dual) source
      ON (target.${quoteIdentifier(insertColumns[oldIdIndex])} = source.${quoteIdentifier(insertColumns[oldIdIndex])})${updateClause}
      WHEN NOT MATCHED THEN INSERT (${quotedColumns})
      VALUES (${insertColumns.map((column) => `source.${quoteIdentifier(column)}`).join(", ")})`;
    const bindRows = rows.map((_, rowIndex) => insertData.map((column) => column.values[rowIndex]));
    const bindDefs = insertData.map(({ type, maxSize }) =>
      maxSize === undefined ? { type } : { type, maxSize },
    );

    const result = await connection.executeMany(upsertSql, bindRows, { bindDefs, batchErrors: true });

    if (result.batchErrors && result.batchErrors.length > 0) {
      const samples = result.batchErrors.slice(0, 5).map((batchError) => {
        const rowNumber = batchError.offset + 2;
        const errorCode = batchError.errorNum ? `ORA-${String(batchError.errorNum).padStart(5, "0")}: ` : "";
        return `row ${rowNumber} (${errorCode}${batchError.message})`;
      });
      throw new Error(
        `Oracle rejected ${result.batchErrors.length} uploaded row(s). Sample errors: ${samples.join("; ")}`,
      );
    }

    await connection.commit();
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Database rollback failed:", rollbackError.message);
      }
    }
    throw error;
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (closeError) {
        console.error("Database connection close failed:", closeError.message);
      }
    }
  }
}

app.get("/api/master-data/check/:type", async (req, res, next) => {
  try {
    res.json(await checkMasterDataIds(req.params.type));
  } catch (error) {
    if (error.status === 400 || error.status === 503) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error("Master data ID check failed:", error.message);
    next(httpError(500, error.status ? error.message : "Unable to check master data IDs."));
  }
});

app.post("/api/upload", upload.single("file"), async (req, res, next) => {
  if (!req.file) {
    res.status(400).json({ error: "Choose a file to upload." });
    return;
  }

  let workbook;
  try {
    workbook = XLSX.read(req.file.buffer, { type: "buffer", cellDates: true });
  } catch {
    res.status(400).json({
      error: "The uploaded file could not be read. Check that it is a valid Excel or CSV file.",
    });
    return;
  }
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    res.status(400).json({ error: "The uploaded file does not contain a worksheet." });
    return;
  }

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
  console.log(`Parsed ${rows.length} rows from worksheet "${sheetName}" in file "${req.file.originalname}".`);
  if (rows.length === 0) {
    res.status(400).json({ error: "The uploaded worksheet contains no data rows." });
    return;
  }

  try {
    await upsertTableData(rows);
    res.json({ filename: req.file.originalname, sheetName, rows, processed: rows.length });
  } catch (error) {
    if (error.status === 400 || error.status === 503) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error("Upload database operation failed:", error.message);
    next(httpError(500, "Upload failed; database changes were rolled back."));
  }
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    res.status(status).json({
      error: error.code === "LIMIT_FILE_SIZE"
        ? "The file must be 100 MB or smaller."
        : "Upload exactly one file.",
    });
    return;
  }

  if (error) {
    const isUnsupportedFile = error.message.startsWith("Only .xlsx");
    const status = isUnsupportedFile ? 400 : error.status || 500;
    res.status(status).json({
      error: isUnsupportedFile
        ? error.message
        : error.status
          ? error.message
          : status === 400
            ? "The uploaded file could not be read. Check that it is a valid Excel or CSV file."
            : "An unexpected server error occurred.",
    });
    return;
  }
  next();
});

app.listen(port, () => {
  console.log(`Migration API listening on http://localhost:${port}`);
});
