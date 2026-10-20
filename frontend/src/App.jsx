// src/App.jsx
import React, { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { ArrowLeft, Loader2, Upload, AlertCircle, CheckCircle, XCircle, Plus } from "lucide-react";

// Sample master data – in a real app this would be fetched from the backend
const masterData = {
  provinces: ["Province A", "Province B", "Province C"],
  districts: ["District 1", "District 2", "District 3"],
  regiments: ["Regiment X", "Regiment Y"],
  ranks: ["Private", "Sergeant", "Captain"],
};

export default function App() {
  const [summary, setSummary] = useState({ total: 0, valid: 0, missing: 0 });
  const [loading, setLoading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadSuccess, setUploadSuccess] = useState("");
  const [newMaster, setNewMaster] = useState({ type: "", value: "" });
  const [showModal, setShowModal] = useState(false);
  const [page, setPage] = useState("migration");
  const [selectedMaster, setSelectedMaster] = useState("");
  const [masterCheck, setMasterCheck] = useState(null);
  const [masterLoading, setMasterLoading] = useState(false);
  const [masterError, setMasterError] = useState("");
 const [records, setRecords] = useState([]);
 const [missing, setMissing] = useState([]);
  const [locationSyncLoading, setLocationSyncLoading] = useState(false);
  const [locationSyncError, setLocationSyncError] = useState("");
  const [locationSyncSuccess, setLocationSyncSuccess] = useState("");

  const syncLocationIds = async () => {
    setLocationSyncLoading(true);
    setLocationSyncError("");
    setLocationSyncSuccess("");
    try {
      const response = await fetch("/api/temp-members/sync-location-ids", {
        method: "POST",
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Location ID sync failed.");
      }
      setLocationSyncSuccess(
        `Location IDs synced for ${result.updated} matching temporary member records.`,
      );
    } catch (error) {
      console.error("Temporary member location sync error:", error);
      setLocationSyncError(error.message || "Unable to sync location IDs.");
    } finally {
      setLocationSyncLoading(false);
    }
  };

  const checkMasterData = async (type) => {
    setSelectedMaster(type);
    setMasterCheck(null);
    setMasterError("");
    setMasterLoading(true);
    try {
      const response = await fetch(`/api/master-data/check/${type}`);
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Master data check failed.");
      }
      setMasterCheck(result);
    } catch (error) {
      console.error("Master data check error:", error);
      setMasterError(error.message || "Unable to check master data IDs.");
    } finally {
      setMasterLoading(false);
    }
  };

  const onDrop = useCallback(async (acceptedFiles, fileRejections) => {
    if (acceptedFiles.length === 0) {
      if (fileRejections.length > 0) {
        setUploadError(fileRejections[0].errors[0].message);
      }
      return;
    }
    const file = acceptedFiles[0];
    setLoading(true);
    setUploadError("");
    setUploadSuccess("");
    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "File upload failed.");
      }
      validateData(result.rows);
      setUploadSuccess(
        `${result.processed} records processed: existing OLD_IDs updated, new OLD_IDs inserted, and matching location IDs synced. Other records were kept.`,
      );
    } catch (error) {

      console.error("Upload error:", error);
      setUploadError(error.message || "Unable to read the uploaded file.");
    } finally {
      setLoading(false);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      "application/vnd.ms-excel": [".xls"],
      "text/csv": [".csv"],
    },
    maxSize: 100 * 1024 * 1024,
    multiple: false,
    disabled: loading || locationSyncLoading,
  });

  const validateData = (rows) => {
    const missingRows = [];
    rows.forEach((row, idx) => {
      const missingFields = [];
      // example column names – adjust to actual Excel header names
      if (row["province"] && !masterData.provinces.includes(row["province"])) {
        missingFields.push("province");
      }
      if (row["district"] && !masterData.districts.includes(row["district"])) {
        missingFields.push("district");
      }
      if (row["regiment"] && !masterData.regiments.includes(row["regiment"])) {
        missingFields.push("regiment");
      }
      if (row["rank"] && !masterData.ranks.includes(row["rank"])) {
        missingFields.push("rank");
      }
      if (missingFields.length > 0) {
        missingRows.push({ index: idx + 2, data: row, missingFields }); // +2 for header & 1‑based index
      }
    });
    setRecords(rows);
    setMissing(missingRows);
    setSummary({
      total: rows.length,
      valid: rows.length - missingRows.length,
      missing: missingRows.length,
    });
  };

  const openAddMaster = (type) => {
    setNewMaster({ type, value: "" });
    setShowModal(true);
  };

  const addMasterEntry = () => {
    if (newMaster.type && newMaster.value) {
      // update the in‑memory master data (would be a POST in real app)
      masterData[newMaster.type + "s"].push(newMaster.value);
      setShowModal(false);
    }
  };

  const unmatchedRows = masterCheck?.rows.filter((row) =>
    row.status.startsWith("UNMATCHED"),
  ) ?? [];

  return (
    <div className="max-w-5xl mx-auto p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-army">
          {page === "migration" ? "Army HR Data Migration" : "Check Master Data"}
        </h1>
        {page === "migration" ? (
          <button
            type="button"
            onClick={() => setPage("master-data")}
            className="rounded bg-army px-4 py-2 font-medium text-white hover:bg-army-dark"
          >
            Check Master Data
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setPage("migration")}
            className="inline-flex items-center rounded border px-4 py-2 font-medium text-gray-700 hover:bg-gray-50"
          >
            <ArrowLeft className="mr-2" size={16} /> Back to migration
          </button>
        )}
      </div>

      {page === "master-data" ? (
        <section>
          <p className="mb-4 text-gray-600">
            Check each distinct source value in PNRDB_DEV.&quot;01_Temp_members_master_data&quot; against the selected master table.
          </p>
          <div className="mb-6 flex flex-wrap gap-3">
            {[
              { label: "District", type: "districts" },
              { label: "Provinces", type: "provinces" },
              { label: "GN Divisions", type: "gnDivisions" },
              { label: "Banks", type: "banks" },
              { label: "Branches", type: "branches" },
              { label: "Races", type: "races" },
              { label: "Religions", type: "religions" },
              { label: "NATIONALITY", type: "nationalities" },
              { label: "ELECTORATE_DIVISION", type: "electorate_divisions" },
              { label: "RANK", type: "ranks" },
              { label: "DIVISIONAL_SECRETARIAT", type: "divisional_secretariats" },
              { label: "GENDER_ID", type: "genders" },
              { label: "MEMBER_CATEGORY_ID", type: "member_categories" },
            ].map(({ label, type }) => (
              <button
                key={type}
                type="button"
                onClick={() => checkMasterData(type)}
                disabled={masterLoading}
                className={`rounded px-5 py-2 font-medium ${
                  selectedMaster === type
                    ? "bg-army text-white"
                    : "border border-army text-army hover:bg-army-light"
                } disabled:cursor-wait disabled:opacity-60`}
              >
                {label}
              </button>
            ))}
          </div>
          {masterLoading && (
            <div role="status" className="mb-4 flex items-center text-army">
              <Loader2 className="mr-2 animate-spin" size={18} /> Checking values…
            </div>
          )}
          {masterError && (
            <div role="alert" className="mb-4 flex items-center text-red-600">
              <AlertCircle className="mr-2" size={18} /> {masterError}
            </div>
          )}
          {masterCheck && (
            <>
              <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded bg-white p-4 shadow">
                  <p className="text-sm text-gray-500">Values checked</p>
                  <p className="text-xl font-semibold text-army">{masterCheck.total}</p>
                </div>
                <div className="rounded bg-white p-4 shadow">
                  <p className="text-sm text-gray-500">Not found in {masterCheck.table}</p>
                  <p className="text-xl font-semibold text-red-600">{masterCheck.unmatched}</p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full rounded bg-white shadow">
                  <thead className="bg-army-light">
                    <tr>
                      <th className="px-4 py-2 text-left">Temporary {masterCheck.sourceColumn}</th>
                      <th className="px-4 py-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unmatchedRows.length > 0 ? unmatchedRows.map((row, index) => (
                      <tr key={`${row.id}-${index}`} className="border-t">
                        <td className="px-4 py-2 font-mono">{row.id}</td>
                        <td className="px-4 py-2 font-medium text-red-600">
                          {row.status}
                        </td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan={2} className="px-4 py-6 text-center text-gray-500">
                          {masterCheck.total === 0
                            ? `No non-empty ${masterCheck.sourceColumn} values were found in the temporary table.`
                            : `All ${masterCheck.total} values are available in ${masterCheck.table}.`}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      ) : (
      <>
      {/* Uploader */}
      <section className="mb-6">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={syncLocationIds}
            disabled={locationSyncLoading || loading}
            className="inline-flex items-center rounded bg-army px-4 py-2 font-medium text-white hover:bg-army-dark disabled:cursor-wait disabled:opacity-60"
          >
            {locationSyncLoading && <Loader2 className="mr-2 animate-spin" size={16} />}
            {locationSyncLoading ? "Syncing location IDs…" : "Sync temp member location IDs"}
          </button>
          <p className="text-sm text-gray-600">
            Update province, district, and divisional secretariat IDs for matching OLD_ID records.
          </p>
        </div>
        {locationSyncError && (
          <div role="alert" className="mb-3 flex items-center text-red-600">
            <AlertCircle className="mr-2" size={18} /> {locationSyncError}
          </div>
        )}
        {locationSyncSuccess && (
          <div role="status" className="mb-3 flex items-center text-green-700">
            <CheckCircle className="mr-2" size={18} /> {locationSyncSuccess}
          </div>
        )}
        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
            loading || locationSyncLoading ? "cursor-wait opacity-60" : "cursor-pointer"
          } ${
            isDragActive ? "border-army" : "border-gray-300"
          }`}
        >
          <input {...getInputProps()} />
          {isDragActive ? (
            <p className="text-army">Drop the file here …</p>
          ) : (
            <>
              <Upload className="mx-auto mb-2 text-army" size={48} />
              <p className="font-medium">Drag & drop an Excel/CSV file here, or click to select</p>
              <p className="text-sm text-gray-500">Maximum file size: 100 MB</p>
              <p className="text-sm text-gray-500">Include the OLD_ID column and the member data columns to import.</p>
              <p className="mt-2 text-sm text-amber-700">Existing members are updated by OLD_ID; new OLD_IDs are inserted. Other records are never deleted.</p>
            </>
          )}
        </div>
        {loading && (
          <div className="mt-2 flex items-center text-army">
            <Loader2 className="animate-spin mr-2" /> Uploading and updating database records…
          </div>
        )}
        {uploadError && (
          <div role="alert" className="mt-2 flex items-center text-red-600">
            <AlertCircle className="mr-2" size={18} /> {uploadError}
          </div>
        )}
        {uploadSuccess && (
          <div role="status" className="mt-2 flex items-center text-green-700">
            <CheckCircle className="mr-2" size={18} /> {uploadSuccess}
          </div>
        )}
      </section>

      {/* Summary cards */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white shadow rounded p-4 flex items-center">
          <div className="flex-1">
            <p className="text-sm text-gray-500">Total Records</p>
            <p className="text-xl font-semibold text-army">{summary.total}</p>
          </div>
        </div>
        <div className="bg-white shadow rounded p-4 flex items-center">
          <div className="flex-1">
            <p className="text-sm text-gray-500">Valid Records</p>
            <p className="text-xl font-semibold text-army">{summary.valid}</p>
          </div>
        </div>
        <div className="bg-white shadow rounded p-4 flex items-center">
          <div className="flex-1">
            <p className="text-sm text-gray-500">Missing Master Data</p>
            <p className="text-xl font-semibold text-red-600">{summary.missing}</p>
          </div>
        </div>
      </section>
      </>
      )}
    </div>
  );
}
