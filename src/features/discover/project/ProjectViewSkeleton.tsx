import { Skeleton } from "@/components/ui";

export function ProjectViewSkeleton() {
  return (
    <div>
      <Skeleton className="h-[180px] w-full rounded-card" />
      <div className="-mt-9 flex items-start gap-5 px-5">
        <div className="rounded-card bg-panel p-1">
          <Skeleton className="h-[96px] w-[96px] rounded-card" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2 pt-11">
          <Skeleton className="h-7 w-2/5" />
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-4 w-3/5" />
        </div>
      </div>
      <div className="mt-5 flex items-center gap-5 px-5">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-36" />
        <div className="flex-1" />
        <Skeleton className="h-9 w-[150px]" />
      </div>
      <div className="mt-10 flex gap-8">
        <div className="flex flex-1 flex-col gap-3">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="mt-3 h-48 w-full rounded-card" />
        </div>
        <div className="flex w-[248px] shrink-0 flex-col gap-3">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-16" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-24" />
        </div>
      </div>
    </div>
  );
}
