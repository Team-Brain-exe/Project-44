import { useEffect, useState } from "react";
import { subscribeToVessels } from "../services/aisstream";
import { fetchOpenSkyAircraft } from "../services/opensky";
import {
  fetchRiskCorridors,
  type VesselPosition,
  type AircraftPosition,
  type RiskCorridor,
} from "../services/liveData";

const AIRCRAFT_POLL_MS = 15_000;
const CORRIDOR_POLL_MS = 60_000;

export function useVessels() {
  const [data, setData] = useState<VesselPosition[]>([]);

  useEffect(() => {
    const unsubscribe = subscribeToVessels(setData);
    return unsubscribe;
  }, []);

  return {
    data,
    loading: data.length === 0,
    error: null as string | null,
  };
}

export function useAircraft() {
  const [data, setData] = useState<AircraftPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        const result = await fetchOpenSkyAircraft();

        if (!cancelled) {
          setData(result);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load aircraft",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    tick();

    const id = setInterval(tick, AIRCRAFT_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return { data, loading, error };
}

export function useRiskCorridors() {
  const [data, setData] = useState<RiskCorridor[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      const result = await fetchRiskCorridors();

      if (!cancelled) {
        setData(result);
        setLoading(false);
      }
    }

    tick();

    const id = setInterval(tick, CORRIDOR_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return {
    data,
    loading,
    error: null as string | null,
  };
}