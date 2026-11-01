CREATE OR REPLACE FUNCTION drop_all_trigger_vA(table_name text)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    trg RECORD;
    qualified_table regclass := table_name::regclass;
BEGIN
    FOR trg IN
        SELECT tgname, tgfoid::regprocedure AS func_name
        FROM pg_trigger
        WHERE tgrelid = qualified_table AND NOT tgisinternal
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON %s;', trg.tgname, table_name);
        EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE;', trg.func_name);
    END LOOP;
END;
$$;

SELECT drop_all_trigger_vA('table_a');