# 0003 — Consolidate backend capabilities into one crate

Status: accepted.

Keep one `ici-server` crate with capability modules containing rules, use cases and adapters. The separate core crates offered compile-time isolation from frameworks, but their small implementations and single production consumer did not justify the extra manifests and split navigation. This replaces the backend crate organization in decision 0001.

Rules and use cases remain framework-independent by convention, with existing ports and behavior tests preserved. Remove the obsolete cross-crate architecture check and the greeting demonstration, including `/api/hello`. Keep the HTTP and privileged worker executables separate and preserve their credential isolation.
