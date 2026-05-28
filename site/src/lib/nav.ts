"use client";

import { createContext, useContext } from "react";
import type { RouteKey } from "@/types/honcho";

export interface NavContextValue {
  navigate: (key: RouteKey) => void;
  current: RouteKey;
}

const noop = () => undefined;

export const NavContext = createContext<NavContextValue>({
  navigate: noop,
  current: "overview",
});

export function useNav() {
  return useContext(NavContext);
}
