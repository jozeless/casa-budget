-- Minimal Storage contract for isolated SQL permissions; not the real Storage service.
create role service_role nologin bypassrls;
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null,unique(bucket_id,name));
alter table storage.objects enable row level security;
grant usage on schema public,auth,storage to service_role;
grant usage on schema storage to authenticated;
grant select,insert,delete on storage.objects to authenticated;
