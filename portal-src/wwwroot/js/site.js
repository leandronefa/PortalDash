// ============================================================
//  Portal de Dashboards · Scripts del cliente (vanilla JS)
// ============================================================
(function () {
    "use strict";

    // ---- Buscador del catálogo (filtrado en vivo) ----
    var search = document.getElementById("dashSearch");
    if (search) {
        var grid = document.getElementById("cardGrid");
        var noResults = document.getElementById("noResults");
        search.addEventListener("input", function () {
            var term = search.value.trim().toLowerCase();
            var cards = grid ? grid.querySelectorAll(".dash-card") : [];
            var visible = 0;
            cards.forEach(function (card) {
                var hay = (card.getAttribute("data-search") || "");
                var match = hay.indexOf(term) !== -1;
                card.classList.toggle("hidden", !match);
                if (match) visible++;
            });
            if (noResults) noResults.classList.toggle("hidden", visible !== 0);
        });
    }

    // ---- Seleccionar / quitar todos (permisos) ----
    function setAll(selector, value) {
        var container = document.querySelector(selector);
        if (!container) return;
        container.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
            cb.checked = value;
        });
    }
    document.querySelectorAll("[data-check-all]").forEach(function (btn) {
        btn.addEventListener("click", function () { setAll(btn.getAttribute("data-check-all"), true); });
    });
    document.querySelectorAll("[data-uncheck-all]").forEach(function (btn) {
        btn.addEventListener("click", function () { setAll(btn.getAttribute("data-uncheck-all"), false); });
    });

    // ---- Cerrar el menú de usuario al hacer clic fuera ----
    var userMenu = document.querySelector("details.user-menu");
    if (userMenu) {
        document.addEventListener("click", function (e) {
            if (userMenu.open && !userMenu.contains(e.target)) {
                userMenu.open = false;
            }
        });
        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape") userMenu.open = false;
        });
    }
})();
