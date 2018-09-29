#=============================================================================
UUID=workspace-grid@mathematical.coffee.gmail.com
FILES=metadata.json *.js stylesheet.css schemas *.svg *.png
#=============================================================================
default_target: all
.PHONY: clean all zip

clean:
	rm -f $(UUID).zip $(UUID)/schemas/gschemas.compiled

# compile the schemas
schemas:
	@if [ -d $(UUID)/schemas ]; then \
		glib-compile-schemas $(UUID)/schemas; \
	fi

zip: schemas
	zip -rq $(UUID).zip $(FILES:%=$(UUID)/%)

dev-zip: schemas
	(cd $(UUID); \
		zip -rq ../$(UUID).zip $(FILES))

install: schemas
	yes | \cp -r $(UUID) ~/.local/share/gnome-shell/extensions/
	gnome-shell-extension-tool -r workspace-grid@mathematical.coffee.gmail.com
