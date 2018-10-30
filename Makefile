#=============================================================================
UUID=workspace-grid@mathematical.coffee.gmail.com
FILES=metadata.json *.js stylesheet.css schemas *.svg *.png
#=============================================================================
default_target: all
.PHONY: clean all zip install dev-zip

clean:
	rm -f $(UUID).zip src/schemas/gschemas.compiled

# compile the schemas
schemas:
	@if [ -d src/schemas ]; then \
		glib-compile-schemas src/schemas; \
	fi

zip: schemas
	zip -rq $(UUID).zip $(FILES:%=src/%)

dev-zip: schemas
	(cd src; \
		zip -rq ../$(UUID).zip $(FILES))

install: schemas
	mkdir -p ~/.local/share/gnome-shell/extensions/$(UUID)
	yes | \cp -r src/* ~/.local/share/gnome-shell/extensions/$(UUID)/
	gnome-shell-extension-tool -r $(UUID)
