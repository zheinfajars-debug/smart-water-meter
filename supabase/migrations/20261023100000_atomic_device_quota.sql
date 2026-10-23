CREATE OR REPLACE FUNCTION public.add_device_quota(
  p_device_id text,
  p_liter double precision
)
RETURNS double precision
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  updated_quota double precision;
BEGIN
  IF p_liter IS NULL OR p_liter <= 0 THEN
    RAISE EXCEPTION 'Top-up liter must be greater than zero'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.devices
  SET sisa_liter = COALESCE(sisa_liter, 0) + p_liter
  WHERE device_id = p_device_id
  RETURNING sisa_liter INTO updated_quota;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Device % not found', p_device_id
      USING ERRCODE = 'P0002';
  END IF;

  RETURN updated_quota;
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_device_quota(
  p_device_id text,
  p_liter double precision
)
RETURNS double precision
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  updated_quota double precision;
BEGIN
  IF p_liter IS NULL OR p_liter <= 0 THEN
    RAISE EXCEPTION 'Consumed liter must be greater than zero'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.devices
  SET sisa_liter = GREATEST(COALESCE(sisa_liter, 0) - p_liter, 0)
  WHERE device_id = p_device_id
  RETURNING sisa_liter INTO updated_quota;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Device % not found', p_device_id
      USING ERRCODE = 'P0002';
  END IF;

  RETURN updated_quota;
END;
$$;

REVOKE ALL ON FUNCTION public.add_device_quota(text, double precision) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_device_quota(text, double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_device_quota(text, double precision) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_device_quota(text, double precision) TO anon, authenticated;
