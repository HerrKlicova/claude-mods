# claude-mods

Mods para Claude Code.

## tecleo

Cada vez que Claude escribe o edita un archivo, se abre un panel al lado del chat con la ruta del archivo. El código nuevo se va tecleando rápido, con resaltado de sintaxis y cursor parpadeante. En una edición, las líneas que se quitan salen tachadas y se apagan, y las nuevas se teclean en su sitio. Si llegan varias ediciones seguidas, se encolan y la velocidad sube. Los archivos de más de 400 líneas se muestran de golpe. El panel se cierra solo cuando Claude lleva un rato sin escribir. El comando `/tecleo` lo abre o lo cierra a mano. Abajo aparecen los archivos tocados en la sesión: pulsa uno para volver a verlo.

La animación funciona en la CLI (terminal) y en la app de escritorio. En VS Code y en el móvil el panel muestra el diff final sin animar.

Opciones (en `/config` o al instalar): `velocidad` (lento, normal o rapido), `abrirSolo` (abrir el panel al editar) y `cerrarTras` (segundos sin escribir antes de cerrarlo; 0 lo deja abierto).

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
