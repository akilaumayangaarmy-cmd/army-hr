// src/App.jsx
import React, { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Loader2, Upload, AlertCircle, CheckCircle, XCircle, Plus } from "lucide-react";

// Sample master data – in a real app this would be fetched from the backend
const masterData = {
  provinces: ["Province A", "Province B", "Province C"],
  districts: ["District 1", "District 2", "District 3"],
  regiments: ["Regiment X", "Regiment Y"],
  ranks: ["Private", "Sergeant", "Captain"],
};

export default function App() {
  const [records, setRecords] = useState([]); // all parsed rows
  const [missing, setMissing] = useState([]); // rows with missing master data
  const [summary, setSummary] = useState({ total: 0, valid: 0, missing: 0 });
  const [loading, setLoading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadSuccess, setUploadSuccess] = useState("");
  const [newMaster, setNewMaster] = useState({ type: "", value: "" });
  const [showModal, setShowModal] = useState(false);

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
      setUploadSuccess(`${result.inserted} records replaced in the database.`);
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

  return (
    <div className="max-w-5xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4 text-army">Army HR Data Migration</h1>

      {/* Uploader */}
      <section className="mb-6">
        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
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
              <p className="text-sm text-gray-500">Expected columns: e_number, name, province, district, regiment, rank, …</p>
              <p className="mt-2 text-sm text-amber-700">Uploading replaces all existing rows in the destination table.</p>
            </>
          )}
        </div>
        {loading && (
          <div className="mt-2 flex items-center text-army">
            <Loader2 className="animate-spin mr-2" /> Uploading and replacing database data…
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

      {/* Missing data table */}
      {missing.length > 0 && (
        <section className="overflow-x-auto">
          <table className="min-w-full bg-white shadow rounded">
            <thead className="bg-army-light">
              <tr>
                <th className="px-4 py-2 text-left">Row</th>
                <th className="px-4 py-2 text-left">Member ID</th>
                <th className="px-4 py-2 text-left">Missing Fields</th>
                <th className="px-4 py-2 text-left">Action</th>
              </tr>
            </thead>
            <tbody>
              {missing.map((m) => (
                <tr key={m.index} className="border-t">
                  <td className="px-4 py-2">{m.index}</td>
                  <td className="px-4 py-2 font-mono">{m.data["e_number"] || "-"}</td>
                  <td className="px-4 py-2">
                    {m.missingFields.map((f) => (
                      <span
                        key={f}
                        className="inline-block mr-2 mb-1 px-2 py-0.5 text-xs bg-red-100 text-red-800 rounded"
                      >
                        {f}
                      </span>
                    ))}
                  </td>
                  <td className="px-4 py-2">
                    {m.missingFields.map((f) => (
                      <button
                        key={f}
                        onClick={() => openAddMaster(f)}
                        className="inline-flex items-center mr-2 mb-1 px-2 py-0.5 text-xs bg-army-light text-army rounded hover:bg-army"
                      >
                        <Plus className="mr-1" size={12} /> Add {f}
                      </button>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Modal for adding master data */}
      {showModal && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-30">
          <div className="bg-white rounded-lg shadow-lg p-6 w-96">
            <h2 className="text-lg font-semibold mb-4">Add new {newMaster.type}</h2>
            <input
              type="text"
              placeholder={`Enter ${newMaster.type} name`}
              value={newMaster.value}
              onChange={(e) => setNewMaster({ ...newMaster, value: e.target.value })}
              className="w-full border rounded px-2 py-1 mb-4"
            />
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={addMasterEntry}
                className="px-4 py-2 bg-army text-white rounded hover:bg-army-dark"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
