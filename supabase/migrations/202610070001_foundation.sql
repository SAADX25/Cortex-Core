-- Portable PostgreSQL schema. Supabase supplies the anon/authenticated roles.
create type public.part_category as enum ('motherboard', 'cpu', 'gpu', 'ram', 'storage');
create type public.part_status as enum ('development', 'active', 'discontinued');
create table public.manufacturers (id text primary key, name text not null unique check (length(name) > 0));
create table public.parts (
  id text primary key, manufacturer_id text not null references public.manufacturers(id),
  model text not null check (length(model) > 0), slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  category public.part_category not null, release_date date, status public.part_status not null,
  is_fixture boolean not null default false, is_public boolean not null default false,
  visual jsonb not null check (jsonb_typeof(visual) = 'object'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (not is_fixture or status = 'development'), unique(id, category)
);
create index parts_category_cursor on public.parts(category, id);
create table public.part_sources (
  part_id text not null references public.parts(id) on delete cascade, field_path text not null,
  url text, organization text not null, verified_at timestamptz not null,
  status text not null check (status in ('verified', 'unverified', 'fixture')),
  confidence numeric not null check (confidence between 0 and 1), primary key(part_id, field_path),
  check (status = 'fixture' or (url is not null and url ~ '^https?://'))
);
create table public.motherboard_specs (
  part_id text primary key, category public.part_category not null default 'motherboard' check(category = 'motherboard'),
  socket text, socket_type text, cpu_families text[], form_factor text, chipset text, memory_generation text,
  dimm_slots integer check (dimm_slots > 0), max_memory_gb numeric check (max_memory_gb > 0),
  pcie_generation integer check (pcie_generation > 0), pcie_lanes integer check(pcie_lanes > 0), sata_ports integer check(sata_ports >= 0),
  foreign key(part_id, category) references public.parts(id, category) on delete cascade
);
create table public.m2_slots (
  board_id text not null references public.motherboard_specs(part_id) on delete cascade,
  semantic_id text not null, key text, interfaces text[], lengths_mm integer[],
  primary key(board_id, semantic_id), check(interfaces is null or interfaces <@ array['nvme','sata']),
  check(lengths_mm is null or (0 < all(lengths_mm)))
);
create table public.cpu_specs (
  part_id text primary key, category public.part_category not null default 'cpu' check(category = 'cpu'),
  socket text, family text, cores integer check(cores > 0), tdp_watts numeric check(tdp_watts > 0),
  foreign key(part_id, category) references public.parts(id, category) on delete cascade
);
create table public.gpu_specs (
  part_id text primary key, category public.part_category not null default 'gpu' check(category = 'gpu'),
  pcie_generation integer check(pcie_generation > 0), pcie_lanes integer check(pcie_lanes > 0),
  power_watts numeric check(power_watts > 0), power_connectors text[],
  foreign key(part_id, category) references public.parts(id, category) on delete cascade
);
create table public.ram_specs (
  part_id text primary key, category public.part_category not null default 'ram' check(category = 'ram'),
  generation text, capacity_gb numeric check(capacity_gb > 0), module_count integer check(module_count > 0), speed_mt numeric check(speed_mt > 0),
  foreign key(part_id, category) references public.parts(id, category) on delete cascade
);
create table public.storage_specs (
  part_id text primary key, category public.part_category not null default 'storage' check(category = 'storage'),
  interface text check(interface in ('nvme', 'sata')), form_factor text, key text,
  length_mm numeric check(length_mm > 0), capacity_gb numeric check(capacity_gb > 0),
  foreign key(part_id, category) references public.parts(id, category) on delete cascade
);
create function public.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;
create trigger parts_updated_at before update on public.parts for each row execute function public.touch_updated_at();

-- All exposed tables deny writes to API roles; imported rows are private by default.
alter table public.manufacturers enable row level security;
alter table public.parts enable row level security;
alter table public.part_sources enable row level security;
alter table public.motherboard_specs enable row level security;
alter table public.m2_slots enable row level security;
alter table public.cpu_specs enable row level security;
alter table public.gpu_specs enable row level security;
alter table public.ram_specs enable row level security;
alter table public.storage_specs enable row level security;
create policy manufacturers_read on public.manufacturers for select to anon, authenticated using (true);
create policy published_parts_read on public.parts for select to anon, authenticated using (is_public);
create policy sources_read on public.part_sources for select to anon, authenticated using (exists(select 1 from public.parts p where p.id = part_id and p.is_public));
create policy board_read on public.motherboard_specs for select to anon, authenticated using (exists(select 1 from public.parts p where p.id = part_id and p.is_public));
create policy m2_read on public.m2_slots for select to anon, authenticated using (exists(select 1 from public.parts p where p.id = board_id and p.is_public));
create policy cpu_read on public.cpu_specs for select to anon, authenticated using (exists(select 1 from public.parts p where p.id = part_id and p.is_public));
create policy gpu_read on public.gpu_specs for select to anon, authenticated using (exists(select 1 from public.parts p where p.id = part_id and p.is_public));
create policy ram_read on public.ram_specs for select to anon, authenticated using (exists(select 1 from public.parts p where p.id = part_id and p.is_public));
create policy storage_read on public.storage_specs for select to anon, authenticated using (exists(select 1 from public.parts p where p.id = part_id and p.is_public));
revoke all on public.manufacturers, public.parts, public.part_sources, public.motherboard_specs, public.m2_slots, public.cpu_specs, public.gpu_specs, public.ram_specs, public.storage_specs from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.manufacturers, public.parts, public.part_sources, public.motherboard_specs, public.m2_slots, public.cpu_specs, public.gpu_specs, public.ram_specs, public.storage_specs to anon, authenticated;
revoke execute on function public.touch_updated_at() from public;

-- Domain projection. Security invoker prevents a view owner from bypassing RLS.
create view public.catalog_records with (security_invoker = true) as
select p.id, p.category, jsonb_build_object(
  'id', p.id, 'manufacturer', m.name, 'model', p.model, 'slug', p.slug, 'category', p.category,
  'releaseDate', p.release_date, 'status', p.status, 'isFixture', p.is_fixture, 'visual', p.visual,
  'createdAt', to_char(p.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'updatedAt', to_char(p.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'provenance', coalesce((select jsonb_object_agg(s.field_path, jsonb_strip_nulls(jsonb_build_object(
    'url', s.url, 'organization', s.organization, 'verifiedAt', to_char(s.verified_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'status', s.status, 'confidence', s.confidence))) from public.part_sources s where s.part_id = p.id), '{}'::jsonb),
  'specs', case p.category
    when 'motherboard' then (select jsonb_build_object('socket', b.socket, 'socketType', b.socket_type, 'cpuFamilies', b.cpu_families, 'formFactor', b.form_factor, 'chipset', b.chipset,
      'memoryGeneration', b.memory_generation, 'dimmSlots', b.dimm_slots, 'maxMemoryGb', b.max_memory_gb, 'pcieGeneration', b.pcie_generation, 'pcieLanes', b.pcie_lanes, 'sataPorts', b.sata_ports,
      'm2Slots', coalesce((select jsonb_agg(jsonb_build_object('id', ms.semantic_id, 'key', ms.key, 'interfaces', ms.interfaces, 'lengthsMm', ms.lengths_mm) order by ms.semantic_id) from public.m2_slots ms where ms.board_id = p.id), '[]'::jsonb)) from public.motherboard_specs b where b.part_id = p.id)
    when 'cpu' then (select jsonb_build_object('socket', c.socket, 'family', c.family, 'cores', c.cores, 'tdpWatts', c.tdp_watts) from public.cpu_specs c where c.part_id = p.id)
    when 'gpu' then (select jsonb_build_object('pcieGeneration', g.pcie_generation, 'pcieLanes', g.pcie_lanes, 'powerWatts', g.power_watts, 'powerConnectors', g.power_connectors) from public.gpu_specs g where g.part_id = p.id)
    when 'ram' then (select jsonb_build_object('generation', r.generation, 'capacityGb', r.capacity_gb, 'moduleCount', r.module_count, 'speedMt', r.speed_mt) from public.ram_specs r where r.part_id = p.id)
    when 'storage' then (select jsonb_build_object('interface', s.interface, 'formFactor', s.form_factor, 'key', s.key, 'lengthMm', s.length_mm, 'capacityGb', s.capacity_gb) from public.storage_specs s where s.part_id = p.id)
  end
) as record from public.parts p join public.manufacturers m on m.id = p.manufacturer_id;
grant select on public.catalog_records to anon, authenticated;
