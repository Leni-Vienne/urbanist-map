# Tests E2E avec Playwright

## Installation et Configuration

Les tests Playwright sont configurés pour tester l'interface utilisateur de Construction Map, particulièrement la partie carte interactive.

### Commandes disponibles

```bash
# Lancer tous les tests
bun run test:e2e

# Interface graphique pour les tests
bun run test:e2e:ui

# Mode debug pour développer les tests
bun run test:e2e:debug

# Installer les navigateurs Playwright
bunx playwright install
```

## Structure des Tests

### Tests par Fonctionnalité

1. **`map-mode-switching.spec.ts`** - Basculement entre modes consultation/édition
2. **`marker-filtering.spec.ts`** - Filtrage des marqueurs par statut
3. **`overlay-loading.spec.ts`** - Chargement conditionnel des images selon le zoom
4. **`overlay-interactions.spec.ts`** - Interactions avec les overlays
5. **`map-functionality.spec.ts`** - Fonctionnalités de base de la carte
6. **`comprehensive-map.spec.ts`** - Tests complets de workflow

### Helpers de Test

Le fichier `helpers/map-helpers.ts` contient des utilitaires pour :
- Attendre l'initialisation de la carte
- Basculer entre les modes
- Gérer le zoom et la navigation
- Compter les marqueurs par couleur
- Tester les filtres

## Points Clés Testés

### Modes Consultation vs Édition

**Mode Consultation :**
- Couleurs basées sur la chronologie de construction
- Vert : projets futurs (pas encore commencés)
- Orange : projets en cours
- Gris : projets terminés

**Mode Édition :**
- Couleurs basées sur l'état des overlays
- Vert : overlay distant non modifié
- Orange : overlay distant modifié localement
- Rouge : overlay local avec changements
- Bleu : nouvel overlay sans changements
- Violet : overlay de remplacement

### Chargement Conditionnel des Images

- Images se chargent uniquement au-delà d'un seuil de zoom
- Images se déchargent lors du dézoom
- Gestion des erreurs de chargement

### Filtrage des Marqueurs

- Boutons pour masquer/afficher les projets par statut
- Persistance des filtres lors du changement de mode
- Impact visuel sur la carte et la sidebar

## Prérequis pour les Tests

1. **Frontend en marche :** `bun run dev-front` sur le port 5173
2. **Backend optionnel :** Certains tests fonctionnent sans backend (navigation, zoom, filtres)
3. **Données de test :** Les tests s'adaptent au contenu disponible

## Exemples d'Usage

```bash
# Test un fichier spécifique
bunx playwright test tests/e2e/map/map-mode-switching.spec.ts

# Test avec interface graphique
bunx playwright test --ui tests/e2e/map/

# Test en mode debug
bunx playwright test --debug tests/e2e/map/comprehensive-map.spec.ts
```

## Améliorations Suggérées

Pour faciliter les tests, vous pourriez ajouter des `data-testid` aux composants critiques :

```vue
<!-- Dans les composants Vue -->
<div class="overlay-item" data-testid="overlay-item">
<button data-testid="filter-not-started">Toggle not started projects</button>
<div class="info-popup" data-testid="info-popup">
```

Cette approche rend les tests plus robustes face aux changements de CSS ou de structure.