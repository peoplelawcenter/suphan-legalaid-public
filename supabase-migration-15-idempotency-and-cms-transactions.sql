-- migration-15: ความถูกต้องของงานแชต + CMS audit แบบ transaction
-- รันหลัง migration-13 และ migration-14 ก่อน deploy โค้ดชุดนี้

-- 1) รหัสส่งที่ไม่ซ้ำสำหรับสร้างเรื่องจากแชต
alter table public.cases add column if not exists submission_id uuid;
create unique index if not exists cases_submission_id_uidx
  on public.cases (submission_id) where submission_id is not null;

-- 2) รหัสส่งที่ไม่ซ้ำสำหรับเพิ่มข้อมูลเข้าเรื่องเดิม
alter table public.case_events add column if not exists idempotency_key uuid;
create unique index if not exists case_events_idempotency_key_uidx
  on public.case_events (idempotency_key) where idempotency_key is not null;

create or replace function public.append_chat_submission(
  p_case_id bigint,
  p_note text,
  p_paths text[],
  p_submission_id uuid
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_case public.cases%rowtype;
  v_existing bigint;
  v_paths text[];
begin
  if p_submission_id is null then raise exception 'submission_id is required'; end if;

  select case_id into v_existing from public.case_events
    where idempotency_key = p_submission_id and action = 'citizen_message';
  if found then
    select * into v_case from public.cases where id = v_existing;
    return to_jsonb(v_case);
  end if;

  select * into v_case from public.cases where id = p_case_id for update;
  if not found then raise exception 'case not found'; end if;
  if v_case.status not in ('new','assigned','in_progress','need_info') then
    raise exception 'case is closed';
  end if;

  select coalesce(array_agg(x order by ord), '{}') into v_paths
  from (
    select x, min(ord) ord
    from unnest(coalesce(v_case.evidence_paths, '{}') || coalesce(p_paths, '{}')) with ordinality t(x, ord)
    where x is not null and x <> ''
    group by x
    order by min(ord)
    limit 12
  ) s;

  update public.cases set evidence_paths = v_paths, updated_at = now()
    where id = p_case_id returning * into v_case;
  insert into public.case_events(case_id, actor, action, note, idempotency_key)
    values (p_case_id, 'citizen', 'citizen_message', left(coalesce(p_note, '(ไม่มีข้อความ)'), 10000), p_submission_id);
  return to_jsonb(v_case);
exception when unique_violation then
  select case_id into v_existing from public.case_events where idempotency_key = p_submission_id;
  select * into v_case from public.cases where id = v_existing;
  return to_jsonb(v_case);
end $$;

revoke execute on function public.append_chat_submission(bigint, text, text[], uuid) from public, anon, authenticated;
grant execute on function public.append_chat_submission(bigint, text, text[], uuid) to service_role;

-- 3) CMS: การแก้ข้อมูลและ site_audit ต้องสำเร็จ/ย้อนกลับพร้อมกัน
create or replace function public.site_cms_save_atomic(
  p_type text, p_id text, p_item jsonb, p_staff_id bigint, p_action text, p_summary text
) returns jsonb
language plpgsql
set search_path = public
as $$
declare v jsonb;
begin
  if p_type = 'pages' then
    insert into public.site_pages(slug,title,body_html,show_in_menu,sort_order,published,updated_by)
    values (p_item->>'slug',p_item->>'title',coalesce(p_item->>'body_html',''),coalesce((p_item->>'show_in_menu')::boolean,false),
      coalesce((p_item->>'sort_order')::int,0),coalesce((p_item->>'published')::boolean,true),p_staff_id)
    on conflict (slug) do update set title=excluded.title,body_html=excluded.body_html,show_in_menu=excluded.show_in_menu,
      published=excluded.published,updated_by=excluded.updated_by
    returning to_jsonb(site_pages.*) into v;
  elsif p_type = 'banners' then
    if p_id is null then
      insert into public.site_banners(alt_text,caption,image_path,image_w,image_h,mobile_image_path,link_url,sort_order,active,starts_at,ends_at,created_by,updated_by)
      values (p_item->>'alt_text',p_item->>'caption',p_item->>'image_path',(p_item->>'image_w')::int,(p_item->>'image_h')::int,
        p_item->>'mobile_image_path',p_item->>'link_url',coalesce((p_item->>'sort_order')::int,0),coalesce((p_item->>'active')::boolean,true),
        (p_item->>'starts_at')::timestamptz,(p_item->>'ends_at')::timestamptz,p_staff_id,p_staff_id)
      returning to_jsonb(site_banners.*) into v;
    else
      update public.site_banners set alt_text=p_item->>'alt_text',caption=p_item->>'caption',image_path=p_item->>'image_path',
        image_w=(p_item->>'image_w')::int,image_h=(p_item->>'image_h')::int,mobile_image_path=p_item->>'mobile_image_path',
        link_url=p_item->>'link_url',active=coalesce((p_item->>'active')::boolean,true),starts_at=(p_item->>'starts_at')::timestamptz,
        ends_at=(p_item->>'ends_at')::timestamptz,updated_by=p_staff_id where id=p_id::bigint returning to_jsonb(site_banners.*) into v;
    end if;
  elsif p_type = 'posts' then
    if p_id is null then
      insert into public.site_posts(category,title,excerpt,body_html,cover_path,cover_thumb_path,cover_w,cover_h,cover_alt,gallery,attachments,status,pinned,published_at,author_staff_id,updated_by)
      values (p_item->>'category',p_item->>'title',p_item->>'excerpt',coalesce(p_item->>'body_html',''),p_item->>'cover_path',p_item->>'cover_thumb_path',
        (p_item->>'cover_w')::int,(p_item->>'cover_h')::int,p_item->>'cover_alt',coalesce(p_item->'gallery','[]'),coalesce(p_item->'attachments','[]'),
        p_item->>'status',coalesce((p_item->>'pinned')::boolean,false),(p_item->>'published_at')::timestamptz,p_staff_id,p_staff_id)
      returning to_jsonb(site_posts.*) into v;
    else
      update public.site_posts set category=p_item->>'category',title=p_item->>'title',excerpt=p_item->>'excerpt',body_html=coalesce(p_item->>'body_html',''),
        cover_path=p_item->>'cover_path',cover_thumb_path=p_item->>'cover_thumb_path',cover_w=(p_item->>'cover_w')::int,cover_h=(p_item->>'cover_h')::int,
        cover_alt=p_item->>'cover_alt',gallery=coalesce(p_item->'gallery','[]'),attachments=coalesce(p_item->'attachments','[]'),status=p_item->>'status',
        pinned=coalesce((p_item->>'pinned')::boolean,false),published_at=(p_item->>'published_at')::timestamptz,updated_by=p_staff_id
        where id=p_id::bigint returning to_jsonb(site_posts.*) into v;
    end if;
  elsif p_type = 'people' then
    if p_id is null then
      insert into public.site_people(group_key,name,position,organization,photo_path,photo_thumb_path,bio,show_on_home,sort_order,active,updated_by)
      values (p_item->>'group_key',p_item->>'name',p_item->>'position',p_item->>'organization',p_item->>'photo_path',p_item->>'photo_thumb_path',p_item->>'bio',
        coalesce((p_item->>'show_on_home')::boolean,false),coalesce((p_item->>'sort_order')::int,0),coalesce((p_item->>'active')::boolean,true),p_staff_id)
      returning to_jsonb(site_people.*) into v;
    else
      update public.site_people set group_key=p_item->>'group_key',name=p_item->>'name',position=p_item->>'position',organization=p_item->>'organization',
        photo_path=p_item->>'photo_path',photo_thumb_path=p_item->>'photo_thumb_path',bio=p_item->>'bio',show_on_home=coalesce((p_item->>'show_on_home')::boolean,false),
        active=coalesce((p_item->>'active')::boolean,true),updated_by=p_staff_id where id=p_id::bigint returning to_jsonb(site_people.*) into v;
    end if;
  elsif p_type = 'faqs' then
    if p_id is null then
      insert into public.site_faqs(question,answer_html,category,sort_order,active,updated_by)
      values (p_item->>'question',coalesce(p_item->>'answer_html',''),p_item->>'category',coalesce((p_item->>'sort_order')::int,0),coalesce((p_item->>'active')::boolean,true),p_staff_id)
      returning to_jsonb(site_faqs.*) into v;
    else
      update public.site_faqs set question=p_item->>'question',answer_html=coalesce(p_item->>'answer_html',''),category=p_item->>'category',
        active=coalesce((p_item->>'active')::boolean,true),updated_by=p_staff_id where id=p_id::bigint returning to_jsonb(site_faqs.*) into v;
    end if;
  elsif p_type = 'docs' then
    if p_id is null then
      insert into public.site_documents(title,description,category,file_path,file_name,file_size,file_type,sort_order,active,published_at,updated_by)
      values (p_item->>'title',p_item->>'description',p_item->>'category',p_item->>'file_path',p_item->>'file_name',(p_item->>'file_size')::bigint,
        p_item->>'file_type',coalesce((p_item->>'sort_order')::int,0),coalesce((p_item->>'active')::boolean,true),
        coalesce((p_item->>'published_at')::timestamptz,now()),p_staff_id) returning to_jsonb(site_documents.*) into v;
    else
      update public.site_documents set title=p_item->>'title',description=p_item->>'description',category=p_item->>'category',file_path=p_item->>'file_path',
        file_name=p_item->>'file_name',file_size=(p_item->>'file_size')::bigint,file_type=p_item->>'file_type',active=coalesce((p_item->>'active')::boolean,true),
        published_at=coalesce((p_item->>'published_at')::timestamptz,published_at),updated_by=p_staff_id where id=p_id::bigint
        returning to_jsonb(site_documents.*) into v;
    end if;
  elsif p_type = 'links' then
    if p_id is null then
      insert into public.site_links(kind,label,url,icon,logo_path,sort_order,active,updated_by)
      values (p_item->>'kind',p_item->>'label',p_item->>'url',p_item->>'icon',p_item->>'logo_path',coalesce((p_item->>'sort_order')::int,0),coalesce((p_item->>'active')::boolean,true),p_staff_id)
      returning to_jsonb(site_links.*) into v;
    else
      update public.site_links set kind=p_item->>'kind',label=p_item->>'label',url=p_item->>'url',icon=p_item->>'icon',logo_path=p_item->>'logo_path',
        active=coalesce((p_item->>'active')::boolean,true),updated_by=p_staff_id where id=p_id::bigint returning to_jsonb(site_links.*) into v;
    end if;
  else
    raise exception 'unsupported cms type';
  end if;
  if v is null then raise exception 'cms item not found'; end if;
  insert into public.site_audit(staff_id,action,item_type,item_id,summary)
    values (p_staff_id,left(p_action,30),left(p_type,30),left(coalesce(p_id,v->>'id',v->>'slug'),60),left(p_summary,300));
  return v;
end $$;

revoke execute on function public.site_cms_save_atomic(text, text, jsonb, bigint, text, text) from public, anon, authenticated;
grant execute on function public.site_cms_save_atomic(text, text, jsonb, bigint, text, text) to service_role;

create or replace function public.site_cms_delete_atomic(
  p_type text, p_id text, p_staff_id bigint, p_action text, p_summary text
) returns jsonb language plpgsql
set search_path = public
as $$
declare v jsonb;
begin
  if p_type='pages' then delete from public.site_pages where slug=p_id returning to_jsonb(site_pages.*) into v;
  elsif p_type='banners' then delete from public.site_banners where id=p_id::bigint returning to_jsonb(site_banners.*) into v;
  elsif p_type='posts' then delete from public.site_posts where id=p_id::bigint returning to_jsonb(site_posts.*) into v;
  elsif p_type='people' then delete from public.site_people where id=p_id::bigint returning to_jsonb(site_people.*) into v;
  elsif p_type='faqs' then delete from public.site_faqs where id=p_id::bigint returning to_jsonb(site_faqs.*) into v;
  elsif p_type='docs' then delete from public.site_documents where id=p_id::bigint returning to_jsonb(site_documents.*) into v;
  elsif p_type='links' then delete from public.site_links where id=p_id::bigint returning to_jsonb(site_links.*) into v;
  else raise exception 'unsupported cms type'; end if;
  if v is null then raise exception 'cms item not found'; end if;
  insert into public.site_audit(staff_id,action,item_type,item_id,summary)
    values (p_staff_id,left(p_action,30),left(p_type,30),left(p_id,60),left(p_summary,300));
  return v;
end $$;

revoke execute on function public.site_cms_delete_atomic(text, text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.site_cms_delete_atomic(text, text, bigint, text, text) to service_role;

create or replace function public.site_cms_reorder_atomic(
  p_type text, p_orders jsonb, p_staff_id bigint, p_summary text
) returns integer language plpgsql
set search_path = public
as $$
declare o jsonb; n integer:=0; d jsonb;
begin
  for o in select value from jsonb_array_elements(p_orders) loop
    if p_type='pages' then
      update public.site_pages set sort_order=(o->>'sort_order')::int,updated_by=p_staff_id where slug=o->>'key';
      if not found and o ? 'default' then
        d:=o->'default';
        insert into public.site_pages(slug,title,body_html,show_in_menu,sort_order,published,updated_by)
          values(d->>'slug',d->>'title',d->>'body_html',(d->>'show_in_menu')::boolean,(o->>'sort_order')::int,(d->>'published')::boolean,p_staff_id);
      end if;
    elsif p_type='banners' then update public.site_banners set sort_order=(o->>'sort_order')::int,updated_by=p_staff_id where id=(o->>'key')::bigint;
    elsif p_type='people' then update public.site_people set sort_order=(o->>'sort_order')::int,updated_by=p_staff_id where id=(o->>'key')::bigint;
    elsif p_type='faqs' then update public.site_faqs set sort_order=(o->>'sort_order')::int,updated_by=p_staff_id where id=(o->>'key')::bigint;
    elsif p_type='docs' then update public.site_documents set sort_order=(o->>'sort_order')::int,updated_by=p_staff_id where id=(o->>'key')::bigint;
    elsif p_type='links' then update public.site_links set sort_order=(o->>'sort_order')::int,updated_by=p_staff_id where id=(o->>'key')::bigint;
    else raise exception 'unsupported reorder type'; end if;
    if found then n:=n+1; end if;
  end loop;
  insert into public.site_audit(staff_id,action,item_type,item_id,summary)
    values(p_staff_id,'reorder',left(p_type,30),null,left(p_summary,300));
  return n;
end $$;

revoke execute on function public.site_cms_reorder_atomic(text, jsonb, bigint, text) from public, anon, authenticated;
grant execute on function public.site_cms_reorder_atomic(text, jsonb, bigint, text) to service_role;

create or replace function public.site_cms_config_save_atomic(
  p_value jsonb, p_staff_id bigint
) returns jsonb language plpgsql
set search_path = public
as $$
begin
  insert into public.settings(key,value) values('site_config',p_value)
    on conflict(key) do update set value=excluded.value;
  insert into public.site_audit(staff_id,action,item_type,item_id,summary)
    values(p_staff_id,'config','settings','site_config','แก้ไขตั้งค่าเว็บไซต์');
  return p_value;
end $$;

revoke execute on function public.site_cms_config_save_atomic(jsonb, bigint) from public, anon, authenticated;
grant execute on function public.site_cms_config_save_atomic(jsonb, bigint) to service_role;
