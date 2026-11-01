-- 注册新版引用计数函数
CREATE OR REPLACE FUNCTION drop_all_trigger_vB(table_name text)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    trg RECORD;
    qualified_table regclass := table_name::regclass;
    funcs_to_check OID[];
    f_oid OID;
    ref_count INT;
BEGIN
    SELECT array_agg(DISTINCT tgfoid) INTO funcs_to_check
    FROM pg_trigger WHERE tgrelid = qualified_table AND NOT tgisinternal;

    FOR trg IN
        SELECT tgname FROM pg_trigger
        WHERE tgrelid = qualified_table AND NOT tgisinternal
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON %s;', trg.tgname, table_name);
    END LOOP;

    IF funcs_to_check IS NOT NULL THEN
        FOREACH f_oid IN ARRAY funcs_to_check
        LOOP
            SELECT count(*) INTO ref_count FROM pg_trigger WHERE tgfoid = f_oid;
            -- 引用为 0 才杀
            IF ref_count = 0 THEN
                EXECUTE format('DROP FUNCTION IF EXISTS %s RESTRICT;', f_oid::regprocedure);
            END IF;
        END LOOP;
    END IF;
END;
$$;

SELECT drop_all_trigger_vB('table_a');

SELECT drop_all_trigger_vB('table_b');