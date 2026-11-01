-- 【准备工作：测试数据环境】
CREATE TABLE table_a (id int);
CREATE TABLE table_b (id int);

-- 共用函数
CREATE OR REPLACE FUNCTION func_shared() RETURNS trigger AS $$
BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;

-- A 表私有函数
CREATE OR REPLACE FUNCTION func_exclusive_a() RETURNS trigger AS $$
BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;

-- B 表私有函数
CREATE OR REPLACE FUNCTION func_exclusive_b() RETURNS trigger AS $$
BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;

-- 挂载触发器
CREATE TRIGGER trg_a_shared BEFORE INSERT ON table_a FOR EACH ROW EXECUTE FUNCTION func_shared();
CREATE TRIGGER trg_a_exclusive BEFORE INSERT ON table_a FOR EACH ROW EXECUTE FUNCTION func_exclusive_a();
CREATE TRIGGER trg_b_shared BEFORE INSERT ON table_b FOR EACH ROW EXECUTE FUNCTION func_shared();
CREATE TRIGGER trg_b_exclusive BEFORE INSERT ON table_b FOR EACH ROW EXECUTE FUNCTION func_exclusive_b();