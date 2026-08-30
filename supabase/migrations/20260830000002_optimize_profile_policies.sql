alter policy "Users can read their own profile"
on public.profiles
using ((select auth.uid()) = id);

alter policy "Users can update their own public profile"
on public.profiles
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);
