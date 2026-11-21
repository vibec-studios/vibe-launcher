import { useMutation } from "@tanstack/react-query";
import { useAgent } from "@/app/agent";
import { toast } from "@/components/ui";

export type PowerAction = "start" | "stop" | "restart" | "kill";

export function usePower(serverId: string) {
  const { api } = useAgent();
  return useMutation({
    mutationFn: (action: PowerAction) => api.power(serverId, action),
    onError: (e) => toast.error(e),
  });
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
