
-- drop触发器
CREATE OR REPLACE FUNCTION
public.drop_all_trigger(table_name text)
RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
    trg RECORD;
    -- 1. 安全转换：若表不存在返回 NULL，避免抛出异常中断事务
    qualified_table regclass := to_regclass(table_name);
    funcs_to_check OID[];
    f_oid OID;
    ref_count INT;
BEGIN
    -- 如果表根本不存在，直接安全退出
    IF qualified_table IS NULL THEN
        RETURN;
    END IF;

    -- 2. 记录当前表所有触发器所依赖的函数 OID
    SELECT array_agg(DISTINCT tgfoid)
    INTO funcs_to_check
    FROM pg_trigger
    WHERE tgrelid = qualified_table
        AND NOT tgisinternal;

    -- 3. 仅删除当前表上的触发器（使用 qualified_table 自动获得安全的转义表名）
    FOR trg IN
        SELECT tgname
        FROM pg_trigger
        WHERE tgrelid = qualified_table
            AND NOT tgisinternal
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON %s;', trg.tgname, qualified_table);
    END LOOP;

    -- 4. 清理作为“组成部分”的函数（孤儿检测）
    IF funcs_to_check IS NOT NULL THEN
        FOREACH f_oid IN ARRAY funcs_to_check
        LOOP
            -- 检查全库是否还有其他表的非内部触发器在引用这个函数
            SELECT count(*)
            INTO ref_count
            FROM pg_trigger
            WHERE tgfoid = f_oid
                AND NOT tgisinternal;

            -- 如果没有任何触发器在用了，说明它彻底成了孤儿，立即安全销毁！
            IF ref_count = 0 THEN
                EXECUTE format('DROP FUNCTION IF EXISTS %s RESTRICT;', f_oid::regprocedure);
            END IF;
        END LOOP;
    END IF;
END;
$$;

SELECT drop_all_trigger('table_a');

SELECT drop_all_trigger('table_b');