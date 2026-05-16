"use client";

import { useState } from "react";

interface Props {
  faultType: string;
  severity: string;
  technicianNotes: string | null;
  imageUrl: string;
}

export default function TicketForm({ faultType, severity, technicianNotes, imageUrl }: Props) {
  const [submitted, setSubmitted] = useState(false);
  const [location, setLocation] = useState("");
  const [chargerUnit, setChargerUnit] = useState("");
  const [contact, setContact] = useState("");

  const ticketId = `TKT-${Date.now().toString(36).toUpperCase()}`;

  if (submitted) {
    return (
      <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
        <div className="flex items-center gap-3 mb-2">
          <span className="text-2xl">✅</span>
          <div>
            <p className="font-semibold text-blue-800">Technician Ticket Submitted</p>
            <p className="text-xs text-blue-600">Ticket ID: <span className="font-mono font-bold">{ticketId}</span></p>
          </div>
        </div>
        <p className="text-xs text-blue-700 mt-2">
          A technician will be dispatched within 4–8 business hours. Please do not attempt to use or tamper with the charger until it has been inspected.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <h3 className="font-semibold text-sm text-slate-700 mb-1 flex items-center gap-2">
        <span>📋</span> Raise Technician Ticket
      </h3>
      <p className="text-xs text-slate-400 mb-4">
        Severity: <strong>{severity}</strong> · Fault: {faultType.replace(/_/g, " ")}
      </p>

      <div className="flex flex-col gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Charger Location / Site Name</label>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. Sunway Pyramid P2 Level, Bay 04"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Charger Unit ID</label>
          <input
            type="text"
            value={chargerUnit}
            onChange={(e) => setChargerUnit(e.target.value)}
            placeholder="e.g. CU-2031 (shown on charger label)"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Your Contact Number</label>
          <input
            type="tel"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="e.g. 012-345 6789"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
          />
        </div>

        {technicianNotes && (
          <div className="bg-slate-50 rounded-lg px-3 py-2 border border-slate-200">
            <p className="text-xs text-slate-500 font-medium mb-1">AI Notes for Technician:</p>
            <p className="text-xs text-slate-600">{technicianNotes}</p>
          </div>
        )}

        <button
          onClick={() => setSubmitted(true)}
          disabled={!location || !chargerUnit}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded-xl text-sm transition-all"
        >
          Submit Technician Request
        </button>
      </div>
    </div>
  );
}
