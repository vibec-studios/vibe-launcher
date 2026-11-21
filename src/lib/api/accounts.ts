import { call } from "./call";
import type * as T from "../types";

export const accountsApi = {
  // ---------------------------------------------------------------- Accounts
  accountsList: () => call<T.Account[]>("accounts_list"),
  accountRemove: (id: string) => call<void>("account_remove", { id }),
  accountSetActive: (id: string) => call<void>("account_set_active", { id }),
  accountRefresh: (id: string) => call<T.Account>("account_refresh", { id }),
  authMsaAvailable: () => call<boolean>("auth_msa_available"),
  authMsaBegin: () => call<T.DeviceCode>("auth_msa_begin"),
  authMsaWait: () => call<T.Account>("auth_msa_wait"),
  authMsaCancel: () => call<void>("auth_msa_cancel"),
  authMsaWindowLogin: (title: string) => call<T.Account>("auth_msa_window_login", { title }),

  // ---------------------------------------------------------------- Skins & Capes (accountId null = aktiver Account)
  skinsProfile: (accountId?: string | null) => call<T.SkinProfile>("skins_profile", { accountId: accountId ?? null }),
  skinUploadFile: (accountId: string | null, path: string, variant: T.SkinVariant) =>
    call<T.SkinProfile>("skin_upload_file", { accountId, path, variant }),
  skinApplyLibrary: (accountId: string | null, id: string, variant?: T.SkinVariant | null) =>
    call<T.SkinProfile>("skin_apply_library", { accountId, id, variant: variant ?? null }),
  skinSetVariant: (accountId: string | null, variant: T.SkinVariant) => call<T.SkinProfile>("skin_set_variant", { accountId, variant }),
  skinReset: (accountId: string | null) => call<T.SkinProfile>("skin_reset", { accountId }),
  /** capeId null = Cape ausblenden */
  capeSet: (accountId: string | null, capeId: string | null) => call<T.SkinProfile>("cape_set", { accountId, capeId }),
  skinLibraryList: () => call<T.LibrarySkin[]>("skin_library_list"),
  skinLibraryAddFile: (path: string, name?: string | null, variant?: T.SkinVariant | null) =>
    call<T.LibrarySkin>("skin_library_add_file", { path, name: name ?? null, variant: variant ?? null }),
  skinLibraryAddData: (png: string, name: string, variant: T.SkinVariant) => call<T.LibrarySkin>("skin_library_add_data", { png, name, variant }),
  skinLibraryAddCurrent: (accountId: string | null) => call<T.LibrarySkin>("skin_library_add_current", { accountId }),
  skinLibraryImportPlayer: (name: string) => call<T.LibrarySkin>("skin_library_import_player", { name }),
  skinLibraryRename: (id: string, name: string) => call<T.LibrarySkin>("skin_library_rename", { id, name }),
  skinLibrarySetVariant: (id: string, variant: T.SkinVariant) => call<T.LibrarySkin>("skin_library_set_variant", { id, variant }),
  skinLibraryRemove: (id: string) => call<void>("skin_library_remove", { id }),
  skinLibraryExport: (id: string, path: string) => call<void>("skin_library_export", { id, path }),
  skinLibraryReveal: (id: string) => call<void>("skin_library_reveal", { id }),
};
