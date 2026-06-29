-- Total (never-throwing) overlay-fraction function used by boundary assignment (coverageFractionSql).
-- Pure geometry, no table access, deterministic: IMMUTABLE / PARALLEL SAFE. See back/src/db/boundaryAssignment.ts.
CREATE OR REPLACE FUNCTION safe_overlay_fraction(b_geom geometry, p_geom geometry)
RETURNS double precision
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  v_dim integer := ST_Dimension(p_geom);
  v_norm geometry;
BEGIN
  IF v_dim = 2 THEN
    v_norm := ST_CollectionExtract(ST_MakeValid(p_geom), 3);
    RETURN ST_Area(ST_Intersection(b_geom, v_norm)) / NULLIF(ST_Area(v_norm), 0);
  ELSIF v_dim = 1 THEN
    v_norm := ST_CollectionExtract(ST_MakeValid(p_geom), 2);
    RETURN ST_Length(ST_Intersection(b_geom, v_norm)) / NULLIF(ST_Length(p_geom), 0);
  ELSE
    RETURN 1.0;
  END IF;
EXCEPTION WHEN OTHERS THEN
  BEGIN
    RETURN CASE WHEN ST_Contains(b_geom, ST_PointOnSurface(p_geom)) THEN 1.0 ELSE 0.0 END;
  EXCEPTION WHEN OTHERS THEN
    RETURN CASE WHEN ST_Contains(b_geom, ST_Centroid(p_geom)) THEN 1.0 ELSE 0.0 END;
  END;
END;
$$;
