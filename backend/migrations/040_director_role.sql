-- 040_director_role.sql
-- Introduces the seventh role, "Director" — a read-only oversight account that
-- can view every page and every location but cannot write anything
-- (enforced in the backend at the authenticate() choke point, per the
-- Final Instruction Part 1 role list and F.3 alert-wiring table).
--
-- Only the CHECK constraint needs a schema change; read-only enforcement lives
-- in middleware and the Director demo account is created by the seed (idempotent).

ALTER TABLE employees DROP CONSTRAINT IF EXISTS chk_role;
ALTER TABLE employees ADD CONSTRAINT chk_role
  CHECK (role IN ('admin','manager','supervisor','operator','service','shopfloor','director'));
