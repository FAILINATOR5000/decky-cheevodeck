"""Domain mixins composed into Plugin (see main.py).

Plugin.__init__ wires the shared stores/services/clients; the mixins only
read them. Each mixin owns one domain's IPC method family — the split is
organisational, every method keeps its name and its IPC exposure.

main.py imports each mixin from its own module, so there is nothing to
re-export here.
"""
