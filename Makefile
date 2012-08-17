#=============================================================================
UUID=workspace-grid@mathematical.coffee.gmail.com
FILES=metadata.json *.js stylesheet.css schemas *.svg
#=============================================================================
default_target: all
.PHONY: clean all zip

clean:
	rm -f $(UUID).zip $(UUID)/schemas/gschemas.compiled

# compile the schemas
all:
	@if [ -d $(UUID)/schemas ]; then \
		glib-compile-schemas $(UUID)/schemas; \
	fi

zip: all
	zip -rq $(UUID).zip $(FILES:%=$(UUID)/%)

dev-zip: all
	(cd $(UUID); \
		zip -rq ../$(UUID).zip $(FILES))
