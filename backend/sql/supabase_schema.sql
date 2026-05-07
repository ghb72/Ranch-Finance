create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'transaction_type') then
    create type transaction_type as enum ('ingreso', 'gasto');
  end if;

  if not exists (select 1 from pg_type where typname = 'transaction_category') then
    create type transaction_category as enum ('agricultura', 'engorda', 'sierra', 'general');
  end if;

  if not exists (select 1 from pg_type where typname = 'payment_method') then
    create type payment_method as enum ('efectivo', 'transferencia', 'tarjeta', 'cheque');
  end if;

  if not exists (select 1 from pg_type where typname = 'audit_action') then
    create type audit_action as enum ('insert', 'update', 'soft_delete', 'restore', 'conflict');
  end if;
end
$$;

create table if not exists sync_clients (
  client_id text primary key,
  display_name text,
  user_name text,
  last_seen_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists sync_state (
  scope text primary key,
  version bigint not null default 0,
  modified_at timestamptz not null default timezone('utc', now())
);

insert into sync_state (scope, version)
values ('global', 0)
on conflict (scope) do nothing;

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  tipo transaction_type not null,
  monto numeric(14, 2) not null check (monto > 0),
  fecha date not null,
  descripcion text not null default '',
  categoria transaction_category not null default 'general',
  metodo_pago payment_method not null default 'efectivo',
  usuario text not null default 'Usuario',
  comprobante_url text,
  source_client_id text references sync_clients (client_id) on update cascade,
  created_by text,
  updated_by text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz,
  sync_version bigint not null default 1,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists transaction_audit_log (
  id bigint generated always as identity primary key,
  transaction_id uuid not null references transactions (id) on delete cascade,
  action audit_action not null,
  source_client_id text,
  changed_by text,
  before_data jsonb,
  after_data jsonb,
  conflict_note text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_transactions_fecha on transactions (fecha desc);
create index if not exists idx_transactions_updated_at on transactions (updated_at desc);
create index if not exists idx_transactions_sync_version on transactions (sync_version desc);
create index if not exists idx_transactions_active_updated on transactions (updated_at desc) where deleted_at is null;
create index if not exists idx_transactions_source_client on transactions (source_client_id, updated_at desc);
create index if not exists idx_transaction_audit_transaction_id on transaction_audit_log (transaction_id, created_at desc);

create or replace view active_transactions as
select *
from transactions
where deleted_at is null;

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

create or replace function touch_sync_state()
returns void
language plpgsql
as $$
begin
  update sync_state
  set version = version + 1,
      modified_at = timezone('utc', now())
  where scope = 'global';
end;
$$;

create or replace function register_transaction_change()
returns trigger
language plpgsql
as $$
declare
  next_action audit_action;
begin
  if tg_op = 'INSERT' then
    next_action := 'insert';
    new.sync_version := 1;
  elsif tg_op = 'UPDATE' then
    if old.deleted_at is null and new.deleted_at is not null then
      next_action := 'soft_delete';
    elsif old.deleted_at is not null and new.deleted_at is null then
      next_action := 'restore';
    else
      next_action := 'update';
    end if;

    if row_to_json(new) is distinct from row_to_json(old) then
      new.sync_version := old.sync_version + 1;
    end if;
  end if;

  return new;
end;
$$;

create or replace function audit_transaction_change()
returns trigger
language plpgsql
as $$
declare
  next_action audit_action;
begin
  if tg_op = 'INSERT' then
    next_action := 'insert';
    insert into transaction_audit_log (
      transaction_id,
      action,
      source_client_id,
      changed_by,
      after_data
    ) values (
      new.id,
      next_action,
      new.source_client_id,
      coalesce(new.updated_by, new.created_by, new.usuario),
      to_jsonb(new)
    );
  elsif tg_op = 'UPDATE' then
    if old.deleted_at is null and new.deleted_at is not null then
      next_action := 'soft_delete';
    elsif old.deleted_at is not null and new.deleted_at is null then
      next_action := 'restore';
    else
      next_action := 'update';
    end if;

    insert into transaction_audit_log (
      transaction_id,
      action,
      source_client_id,
      changed_by,
      before_data,
      after_data
    ) values (
      new.id,
      next_action,
      new.source_client_id,
      coalesce(new.updated_by, new.created_by, new.usuario),
      to_jsonb(old),
      to_jsonb(new)
    );
  end if;

  perform touch_sync_state();
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_sync_clients_updated_at on sync_clients;
create trigger trg_sync_clients_updated_at
before update on sync_clients
for each row
execute function set_updated_at();

drop trigger if exists trg_transactions_updated_at on transactions;
create trigger trg_transactions_updated_at
before update on transactions
for each row
execute function set_updated_at();

drop trigger if exists trg_transactions_register_change on transactions;
create trigger trg_transactions_register_change
before insert or update on transactions
for each row
execute function register_transaction_change();

drop trigger if exists trg_transactions_audit_change on transactions;
create trigger trg_transactions_audit_change
after insert or update on transactions
for each row
execute function audit_transaction_change();

create or replace function get_sync_state(sync_scope text default 'global')
returns table(version bigint, modified_at timestamptz)
language sql
stable
as $$
  select s.version, s.modified_at
  from sync_state s
  where s.scope = sync_scope;
$$;