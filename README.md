# claude-mods

Mods para Claude Code.

## tecleo

Cada vez que Claude escribe o edita un archivo, se abre un panel al lado del chat con la ruta del archivo. El código nuevo se va tecleando rápido, con resaltado de sintaxis y cursor parpadeante. En una edición, las líneas que se quitan salen tachadas y se apagan, y las nuevas se teclean en su sitio. Si llegan varias ediciones seguidas, se encolan y la velocidad sube. Los archivos de más de 400 líneas se muestran de golpe. El panel se cierra solo cuando Claude lleva un rato sin escribir. El comando `/tecleo` lo abre o lo cierra a mano, y `/tecleo demo` reproduce una edición de ejemplo para probarlo. Abajo aparecen los archivos tocados en la sesión: pulsa uno para volver a verlo.

Por defecto teclea unas 70 letras por segundo; un cambio largo acelera para no tardar más de unos 6 segundos. En la terminal la animación va a 30 fotogramas por segundo; en la app de escritorio, VS Code y el móvil la mueve el propio mod, a unos 20.

Opciones (en `/config` o al instalar): `velocidad` (lento, normal o rapido), `abrirSolo` (abrir el panel al editar) y `cerrarTras` (segundos sin escribir antes de cerrarlo; 0 lo deja abierto).

### Actualizar

Desde una shell, y luego reinicia Claude:

```
claude plugin marketplace update claude-mods
claude plugin update tecleo@claude-mods
```

### Instalar

En la terminal, dentro de Claude Code:

```
/plugin install tecleo --marketplace HerrKlicova/claude-mods
```

Desde una shell:

```
claude plugin install tecleo --marketplace HerrKlicova/claude-mods
```

En la app de escritorio, donde `/plugin` no funciona: pulsa + junto al cuadro de texto, luego Plugins, Add marketplace con `HerrKlicova/claude-mods`, y después Add plugin.
